import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import { AiGateway, type AiCopQuery, type AiCopResponse } from "@cop/ai-gateway";
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
import {
  appendDomainDeadLetter,
  canDeliverDomainEventToNode,
  type EdgeOutboxFlushItemResult,
  type DomainDeadLetterRecord,
  type DomainDeadLetterRedriveResult,
  type DomainEventChannel,
  type DomainEventPublishInput,
  type DomainEventPublishResult,
  type EdgeReplayCursorRecord,
  type FederatedNodeRecord,
  parseDomainEventPublishRequest,
  parseDomainEventReplayQuery,
  publishDomainEventWithResult,
  queryDomainEvents,
  updateFederatedNodeHeartbeat
} from "./federation.js";
import {
  createFederationRuntimeStoreFromEnv,
  type DomainDeadLetterQueryResult,
  type DomainEventReplayResult,
  type FederationRuntimeStore
} from "./federation-runtime-store.js";
import { buildIncidentFusionSuggestions } from "./incident-fusion.js";
import {
  buildIncidentFeatureCollection,
  createIncidentStoreFromEnv,
  InMemoryIncidentStore,
  type CreateIncidentInput,
  type CreateIncidentTaskInput,
  type IncidentActor,
  type IncidentCategory,
  type IncidentLocation,
  type IncidentLocationSource,
  type IncidentQuery,
  type IncidentRecord,
  type IncidentSeverity,
  type IncidentSourceRef,
  type IncidentSourceRefKind,
  type IncidentStatus,
  type IncidentStore,
  type IncidentTaskPriority,
  type IncidentTaskQuery,
  type IncidentTaskRecord,
  type IncidentTaskStatus,
  type IncidentTaskUpdateInput,
  type IncidentUpdateInput
} from "./incident-store.js";
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
  type MessagingProvider,
  type MessagingWebPushDeviceRegistrationRequest
} from "./messaging-provider.js";
import {
  buildCommunityReportNotificationDecision,
  buildSafetyFeatureNotificationDecision,
  type CopNotificationAudience,
  type CopNotificationDecision
} from "./notification-decision.js";
import { createPlaceGeocoderFromEnv, type PlaceGeocoder } from "./place-geocoder.js";
import { withEventProvenance } from "./provenance.js";
import { actorFromRequest, requireBearerToken, type AuthenticatedActor } from "./security.js";
import { buildSourceHealthItems, type SourceHealthItem } from "./source-health.js";
import {
  buildSituationDataHealth,
  createSituationDataSourceConfigFromEnv,
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
  type SafetyDataSourceId,
  type SafetyFeature,
  type SafetyFeatureQuery,
  type SafetyHydroStationDetailQuery,
  type SafetyLayerId
} from "./safety-data-source.js";
import {
  buildSketchDrawingCollection,
  createSketchDrawingStoreFromEnv,
  InMemorySketchDrawingStore,
  sketchPalettes,
  type CreateSketchDrawingInput,
  type SketchDrawingFeature,
  type SketchDrawingKind,
  type SketchDrawingQuery,
  type SketchDrawingStore,
  type SketchDrawingVisibility,
  type SketchGeometry,
  type UpdateSketchDrawingInput
} from "./sketch-store.js";
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
  incidentStore?: IncidentStore;
  federationRuntimeStore?: FederationRuntimeStore;
  mediaStorage?: MediaStorage;
  messagingProvider?: MessagingProvider;
  missionArenaSource?: MissionArenaSource;
  placeGeocoder?: PlaceGeocoder;
  safetyDataSource?: SafetyDataSource;
  sketchDrawingStore?: SketchDrawingStore;
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
const defaultRasterOverlayAllowedHosts = "docker.home.cz,sim.zeleznalady.cz";
const rasterOverlayMaxBytes = 8 * 1024 * 1024;
const defaultWeatherCameraAllowedHosts = defaultRasterOverlayAllowedHosts;
const weatherCameraMaxBytes = 12 * 1024 * 1024;

interface WeatherRadarFramesCacheEntry {
  body: unknown;
  expiresAtMs: number;
}

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

type CopMcpToolId =
  | "cop.area.summary"
  | "cop.audit.events.list"
  | "cop.events.dead_letters.list"
  | "cop.events.replay"
  | "cop.federation.nodes.list"
  | "cop.fusion.explain"
  | "cop.sources.health";

interface CopMcpToolDefinition {
  description: string;
  inputSchema: Record<string, unknown>;
  mode: "read_only";
  output: string;
  toolId: CopMcpToolId;
  title: string;
}

interface CopMcpToolInvocationEnvelope {
  contractVersion: "cop-mcp-tool-invocation-v1";
  generatedAt: string;
  invocationId: string;
  result: Record<string, unknown>;
  status: "ok";
  tool: {
    mode: "read_only";
    toolId: CopMcpToolId;
    title: string;
  };
}

type McpJsonRpcId = string | number | null;

const copMcpTools: CopMcpToolDefinition[] = [
  {
    description: "Build a compact, policy-filtered situation summary for an area from COP map providers. The tool returns sources, uncertainty and confidence; it never changes state.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        bbox: {
          description: "Bounding box as [west,south,east,north] or {west,south,east,north}. Defaults to the flood PoC area.",
          oneOf: [
            {
              items: { type: "number" },
              maxItems: 4,
              minItems: 4,
              type: "array"
            },
            {
              additionalProperties: false,
              properties: {
                east: { type: "number" },
                north: { type: "number" },
                south: { type: "number" },
                west: { type: "number" }
              },
              required: ["west", "south", "east", "north"],
              type: "object"
            }
          ]
        },
        includePartner: { type: "boolean" },
        layerIds: {
          items: { type: "string" },
          maxItems: 24,
          type: "array"
        },
        layers: {
          items: { type: "string" },
          maxItems: 24,
          type: "array"
        },
        limit: { maximum: 500, minimum: 1, type: "integer" }
      },
      type: "object"
    },
    mode: "read_only",
    output: "cop-area-summary-v1",
    title: "Summarize area situation",
    toolId: "cop.area.summary"
  },
  {
    description: "Explain deterministic fusion priorities for an area by correlating COP map evidence across providers. The tool returns evidence, confidence and uncertainty; it never creates or updates incidents.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        bbox: {
          description: "Bounding box as [west,south,east,north] or {west,south,east,north}. Defaults to the flood PoC area.",
          oneOf: [
            {
              items: { type: "number" },
              maxItems: 4,
              minItems: 4,
              type: "array"
            },
            {
              additionalProperties: false,
              properties: {
                east: { type: "number" },
                north: { type: "number" },
                south: { type: "number" },
                west: { type: "number" }
              },
              required: ["west", "south", "east", "north"],
              type: "object"
            }
          ]
        },
        includePartner: { type: "boolean" },
        layerIds: {
          items: { type: "string" },
          maxItems: 24,
          type: "array"
        },
        layers: {
          items: { type: "string" },
          maxItems: 24,
          type: "array"
        },
        limit: { maximum: 500, minimum: 1, type: "integer" },
        priorityLimit: { maximum: 20, minimum: 1, type: "integer" }
      },
      type: "object"
    },
    mode: "read_only",
    output: "cop-area-fusion-v1",
    title: "Explain area fusion priorities",
    toolId: "cop.fusion.explain"
  },
  {
    description: "List registered COP federation nodes for operator diagnostics and edge sync planning.",
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object"
    },
    mode: "read_only",
    output: "cop-federation-node-list-v1",
    title: "List federation nodes",
    toolId: "cop.federation.nodes.list"
  },
  {
    description: "List current COP source health for AI and operator diagnostics. The tool returns structured source status, warnings and freshness metrics; it never changes source configuration.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        health: {
          enum: ["DEGRADED", "DISABLED", "ONLINE", "QUIET", "STALE", "UNAVAILABLE", "WAITING"],
          type: "string"
        },
        includeDisabled: { type: "boolean" }
      },
      type: "object"
    },
    mode: "read_only",
    output: "cop-source-health-v1",
    title: "List source health",
    toolId: "cop.sources.health"
  },
  {
    description: "Replay COP domain events with the same filters as the operator replay endpoint.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        entityId: { type: "string" },
        fromOffset: { minimum: 0, type: "integer" },
        fromTime: { format: "date-time", type: "string" },
        limit: { maximum: 500, minimum: 1, type: "integer" },
        producerNodeId: { type: "string" },
        toTime: { format: "date-time", type: "string" },
        type: { type: "string" }
      },
      type: "object"
    },
    mode: "read_only",
    output: "cop-domain-event-replay-v1",
    title: "Replay domain events",
    toolId: "cop.events.replay"
  },
  {
    description: "List open and recent dead-letter domain events for operator recovery workflows.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        limit: { maximum: 200, minimum: 1, type: "integer" }
      },
      type: "object"
    },
    mode: "read_only",
    output: "cop-domain-event-dlq-v1",
    title: "List domain event dead letters",
    toolId: "cop.events.dead_letters.list"
  },
  {
    description: "List recent COP audit records for operator diagnostics. This exposes only COP audit metadata.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        limit: { maximum: 200, minimum: 1, type: "integer" }
      },
      type: "object"
    },
    mode: "read_only",
    output: "cop-audit-event-list-v1",
    title: "List audit events",
    toolId: "cop.audit.events.list"
  }
];

const floodDemoScenarioId = "flood-central-bohemia";
const floodDemoEventId = "demo-flood-central-bohemia";
const floodDemoOperatorUsernames = ["cop.operator", "op.operator1"];
const floodDemoBbox = {
  east: 15.6,
  north: 50.65,
  south: 49.75,
  west: 13.75
};

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
  const aiGateway = AiGateway.fromEnv(process.env);
  const now = options.now ?? (() => new Date());
  const trackLifecycle = options.trackLifecycle ?? createTrackLifecycleConfig();
  const trackHistoryStore = options.trackHistoryStore ?? createTrackHistoryStoreFromEnv();
  const federationRuntimeStore = options.federationRuntimeStore ?? createFederationRuntimeStoreFromEnv();
  const streamBroadcaster = options.streamBroadcaster ?? createStreamBroadcasterFromEnv();
  const userProfileStore = options.userProfileStore ?? createUserProfileStoreFromEnv();
  const userProfileFallbackStore = new InMemoryUserProfileStore("memory-fallback");
  const communityReportStore = options.communityReportStore ?? createCommunityReportStoreFromEnv();
  const communityReportFallbackStore = new InMemoryCommunityReportStore("memory-fallback");
  const incidentStore = options.incidentStore ?? createIncidentStoreFromEnv();
  const incidentFallbackStore = new InMemoryIncidentStore("memory-fallback");
  const sketchDrawingStore = options.sketchDrawingStore ?? createSketchDrawingStoreFromEnv();
  const sketchDrawingFallbackStore = new InMemorySketchDrawingStore("memory-fallback");
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
  const situationDataBaseUrl = situationDataSource?.config.baseUrl ?? createSituationDataSourceConfigFromEnv().baseUrl;
  const takGatewaySource = options.takGatewaySource ?? createTakGatewaySourceFromEnv();
  const weatherRadarFramesCache = new Map<string, WeatherRadarFramesCacheEntry>();
  const mobileDeviceRegistrations = new Map<string, MobileDeviceRegistration>();
  const edgeReplayCursors = new Map<string, EdgeReplayCursorRecord>();
  let federationRuntimeStoreStatus: DependencyStatus = federationRuntimeStore ? "degraded" : "disabled";
  let federationRuntimeStoreDetail = federationRuntimeStore ? `${federationRuntimeStore.name}: initializing` : "in-memory only";
  let trackHistoryStoreStatus: DependencyStatus = trackHistoryStore ? "degraded" : "disabled";
  let trackHistoryStoreDetail = trackHistoryStore ? `${trackHistoryStore.name}: initializing` : "in-memory only";
  let userProfileStoreStatus: DependencyStatus = "degraded";
  let userProfileStoreDetail = `${userProfileStore.name}: initializing`;
  let communityReportStoreStatus: DependencyStatus = communityReportStore ? "degraded" : "disabled";
  let communityReportStoreDetail = communityReportStore ? `${communityReportStore.name}: initializing` : "disabled";
  let incidentStoreStatus: DependencyStatus = incidentStore ? "degraded" : "disabled";
  let incidentStoreDetail = incidentStore ? `${incidentStore.name}: initializing` : "disabled";
  let sketchDrawingStoreStatus: DependencyStatus = sketchDrawingStore ? "degraded" : "disabled";
  let sketchDrawingStoreDetail = sketchDrawingStore ? `${sketchDrawingStore.name}: initializing` : "disabled";
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
    await initializeFederationRuntimeStore();
    await initializeUserProfileStore();
    await initializeCommunityReportStore();
    await initializeIncidentStore();
    await initializeSketchDrawingStore();
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
    await federationRuntimeStore?.close();
    await userProfileStore.close();
    await userProfileFallbackStore.close();
    await communityReportStore?.close();
    await communityReportFallbackStore.close();
    await incidentStore?.close();
    await incidentFallbackStore.close();
    await sketchDrawingStore?.close();
    await sketchDrawingFallbackStore.close();
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
    const aiGatewayDependency = await withDependencyTimeout(
      "ai-gateway",
      aiGateway.health().then((status) => ({
        name: "ai-gateway",
        status: status.status,
        detail: status.detail
      })),
      {
        name: "ai-gateway",
        status: "degraded",
        detail: `AI gateway dependency check timed out after ${aiHealthDependencyTimeoutMs()} ms.`
      },
      aiHealthDependencyTimeoutMs()
    );
    return {
      status: "ok",
      dependencies: [
      { name: "source-registry", status: "ok" },
      { name: "in-memory-cop-state", status: "ok" },
      { name: "federation-runtime-store", status: federationRuntimeStoreStatus, detail: federationRuntimeStoreDependencyDetail() },
      { name: "track-history-store", status: trackHistoryStoreStatus, detail: trackHistoryStoreDependencyDetail() },
      { name: "user-profile-store", status: userProfileStoreStatus, detail: userProfileStoreDependencyDetail() },
      { name: "community-report-store", status: communityReportStoreStatus, detail: communityReportStoreDependencyDetail() },
      { name: "incident-store", status: incidentStoreStatus, detail: incidentStoreDependencyDetail() },
      { name: "sketch-drawing-store", status: sketchDrawingStoreStatus, detail: sketchDrawingStoreDependencyDetail() },
      { name: "media-storage", status: mediaStorageStatus, detail: mediaStorageDependencyDetail() },
      { name: "place-geocoder", status: placeGeocoder ? "ok" : "disabled", detail: placeGeocoder?.diagnostics?.() ?? "disabled" },
      messaging,
      ...(flightDataSource ? [flightDataDependency()] : []),
      ...(situationDataSource ? [situationDataDependency()] : []),
      ...(safetyDataSource ? [safetyDataDependency()] : []),
      ...(missionArenaSource ? [missionArenaDependency()] : []),
      ...(takGatewaySource ? [takGatewayDependency()] : []),
      aiGatewayDependency
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

  async function initializeFederationRuntimeStore(): Promise<void> {
    if (!federationRuntimeStore) {
      return;
    }
    try {
      await federationRuntimeStore.init(Array.from(state.federatedNodes.values()));
      const persistedNodes = await federationRuntimeStore.listNodes();
      state.federatedNodes.clear();
      for (const node of persistedNodes) {
        state.federatedNodes.set(node.nodeId, node);
      }
      federationRuntimeStoreStatus = "ok";
      federationRuntimeStoreDetail = `${federationRuntimeStore.name}: ready; nodes ${persistedNodes.length}; events ${await federationRuntimeStore.countEvents()}`;
    } catch (error) {
      federationRuntimeStoreStatus = "degraded";
      federationRuntimeStoreDetail = `${federationRuntimeStore.name}: ${errorMessage(error)}`;
      app.log.error({ error }, "Federation runtime store initialization failed; using in-memory fallback.");
    }
  }

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

  async function initializeIncidentStore(): Promise<void> {
    await incidentFallbackStore.init();
    if (!incidentStore) {
      return;
    }
    try {
      await incidentStore.init();
      incidentStoreStatus = "ok";
      incidentStoreDetail = `${incidentStore.name}: ready`;
    } catch (error) {
      incidentStoreStatus = "degraded";
      incidentStoreDetail = `${incidentStore.name}: ${errorMessage(error)}`;
      app.log.error({ error }, "Incident store initialization failed; using in-memory fallback.");
    }
  }

  async function initializeSketchDrawingStore(): Promise<void> {
    await sketchDrawingFallbackStore.init();
    if (!sketchDrawingStore) {
      return;
    }
    try {
      await sketchDrawingStore.init();
      sketchDrawingStoreStatus = "ok";
      sketchDrawingStoreDetail = `${sketchDrawingStore.name}: ready`;
    } catch (error) {
      sketchDrawingStoreStatus = "degraded";
      sketchDrawingStoreDetail = `${sketchDrawingStore.name}: ${errorMessage(error)}`;
      app.log.error({ error }, "Sketch drawing store initialization failed; using in-memory fallback.");
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

  function markFederationRuntimeStoreDegraded(error: unknown): void {
    if (!federationRuntimeStore) {
      return;
    }
    federationRuntimeStoreStatus = "degraded";
    federationRuntimeStoreDetail = `${federationRuntimeStore.name}: ${errorMessage(error)}`;
    app.log.error({ error }, "Federation runtime store failed; using in-memory fallback.");
  }

  function federationRuntimeStoreDependencyDetail(): string {
    const diagnostics = federationRuntimeStore?.diagnostics?.();
    return diagnostics ? `${federationRuntimeStoreDetail}; ${diagnostics}` : federationRuntimeStoreDetail;
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

  function markIncidentStoreDegraded(error: unknown): void {
    if (!incidentStore) {
      return;
    }
    incidentStoreStatus = "degraded";
    incidentStoreDetail = `${incidentStore.name}: ${errorMessage(error)}`;
    app.log.error({ error }, "Incident store failed; using in-memory fallback.");
  }

  function incidentStoreDependencyDetail(): string {
    const diagnostics = incidentStore?.diagnostics?.();
    return diagnostics ? `${incidentStoreDetail}; ${diagnostics}` : incidentStoreDetail;
  }

  function markSketchDrawingStoreDegraded(error: unknown): void {
    if (!sketchDrawingStore) {
      return;
    }
    sketchDrawingStoreStatus = "degraded";
    sketchDrawingStoreDetail = `${sketchDrawingStore.name}: ${errorMessage(error)}`;
    app.log.error({ error }, "Sketch drawing store failed; using in-memory fallback.");
  }

  function sketchDrawingStoreDependencyDetail(): string {
    const diagnostics = sketchDrawingStore?.diagnostics?.();
    return diagnostics ? `${sketchDrawingStoreDetail}; ${diagnostics}` : sketchDrawingStoreDetail;
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
    fallback: T,
    timeoutOverrideMs?: number
  ): Promise<T> {
    const timeoutMs = timeoutOverrideMs ?? healthDependencyTimeoutMs();
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

  function activeIncidentStore(): IncidentStore {
    return incidentStore && incidentStoreStatus === "ok" ? incidentStore : incidentFallbackStore;
  }

  function activeSketchDrawingStore(): SketchDrawingStore {
    return sketchDrawingStore && sketchDrawingStoreStatus === "ok" ? sketchDrawingStore : sketchDrawingFallbackStore;
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
      return { detail: "idle; waiting for first request", name: "situation-data-source", status: "ok" };
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
      return { detail: "idle; waiting for first request", name: "safety-data-source", status: "ok" };
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
      return { detail: "idle; waiting for first request", name: "mission-arena-source", status: "ok" };
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
    return readUserProfileBySubject(actor.subjectId);
  }

  async function readUserProfileBySubject(subjectId: string): Promise<UserProfileRecord | null> {
    try {
      return await activeUserProfileStore().getProfile(subjectId);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      return userProfileFallbackStore.getProfile(subjectId);
    }
  }

  async function searchUserProfiles(query: string, limit = 10): Promise<UserProfileRecord[]> {
    try {
      return await activeUserProfileStore().searchProfiles(query, limit);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      return userProfileFallbackStore.searchProfiles(query, limit);
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

  async function deleteCommunityReportForDemoScenario(reportId: string, demoScenarioId: string, requestNow: Date): Promise<boolean> {
    try {
      return await activeCommunityReportStore().deleteReportForDemoScenario(reportId, demoScenarioId, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.deleteReportForDemoScenario(reportId, demoScenarioId, requestNow);
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

  async function createIncident(input: CreateIncidentInput, requestNow: Date): Promise<IncidentRecord> {
    try {
      return await activeIncidentStore().createIncident(input, requestNow);
    } catch (error) {
      markIncidentStoreDegraded(error);
      return incidentFallbackStore.createIncident(input, requestNow);
    }
  }

  async function readIncident(incidentId: string): Promise<IncidentRecord | null> {
    try {
      return await activeIncidentStore().getIncident(incidentId);
    } catch (error) {
      markIncidentStoreDegraded(error);
      return incidentFallbackStore.getIncident(incidentId);
    }
  }

  async function listIncidents(query: Parameters<IncidentStore["listIncidents"]>[0]): Promise<IncidentRecord[]> {
    try {
      return await activeIncidentStore().listIncidents(query);
    } catch (error) {
      markIncidentStoreDegraded(error);
      return incidentFallbackStore.listIncidents(query);
    }
  }

  async function updateIncident(
    incidentId: string,
    actor: AuthenticatedActor,
    input: IncidentUpdateInput,
    requestNow: Date
  ): Promise<IncidentRecord | null> {
    const incidentActor = actorToIncidentActor(actor);
    try {
      return await activeIncidentStore().updateIncident(incidentId, incidentActor, input, requestNow);
    } catch (error) {
      markIncidentStoreDegraded(error);
      return incidentFallbackStore.updateIncident(incidentId, incidentActor, input, requestNow);
    }
  }

  async function createIncidentTask(input: CreateIncidentTaskInput, requestNow: Date): Promise<IncidentTaskRecord> {
    try {
      return await activeIncidentStore().createTask(input, requestNow);
    } catch (error) {
      markIncidentStoreDegraded(error);
      return incidentFallbackStore.createTask(input, requestNow);
    }
  }

  async function readIncidentTask(taskId: string): Promise<IncidentTaskRecord | null> {
    try {
      return await activeIncidentStore().getTask(taskId);
    } catch (error) {
      markIncidentStoreDegraded(error);
      return incidentFallbackStore.getTask(taskId);
    }
  }

  async function listIncidentTasks(query: Parameters<IncidentStore["listTasks"]>[0]): Promise<IncidentTaskRecord[]> {
    try {
      return await activeIncidentStore().listTasks(query);
    } catch (error) {
      markIncidentStoreDegraded(error);
      return incidentFallbackStore.listTasks(query);
    }
  }

  async function updateIncidentTask(
    taskId: string,
    actor: AuthenticatedActor,
    input: IncidentTaskUpdateInput,
    requestNow: Date
  ): Promise<IncidentTaskRecord | null> {
    const incidentActor = actorToIncidentActor(actor);
    try {
      return await activeIncidentStore().updateTask(taskId, incidentActor, input, requestNow);
    } catch (error) {
      markIncidentStoreDegraded(error);
      return incidentFallbackStore.updateTask(taskId, incidentActor, input, requestNow);
    }
  }

  async function publishIncidentDomainEvent(
    type: "incident.created" | "incident.updated",
    incident: IncidentRecord,
    actor: AuthenticatedActor,
    correlationId: string
  ): Promise<void> {
    await publishRuntimeDomainEvent({
      channel: "cop.domain.events",
      classification: {
        handlingCaveats: ["NO_TARGETING", "NO_WEAPON_WORKFLOW"],
        level: "INTERNAL",
        releasability: ["CIVIL"]
      },
      correlationId,
      entityId: incident.incidentId,
      entityType: "incident",
      payload: {
        incident
      },
      producerNodeId: "node_central_cop",
      provenance: incident.provenance,
      quality: {
        ...(incident.confidence !== undefined ? { confidence: incident.confidence } : {}),
        dataQuality: incident.sourceRefs.length > 0 || incident.provenance.length > 0 ? "mixed" : "observed"
      },
      releasePolicy: {
        allowedScopes: ["internal"],
        visibility: "internal"
      },
      subject: actor.subjectId,
      time: incident.updatedAt,
      type
    });
  }

  async function publishIncidentTaskDomainEvent(
    type: "task.created" | "task.status.changed",
    task: IncidentTaskRecord,
    actor: AuthenticatedActor,
    correlationId: string
  ): Promise<void> {
    await publishRuntimeDomainEvent({
      channel: "cop.domain.events",
      classification: {
        handlingCaveats: ["NO_TARGETING", "NO_WEAPON_WORKFLOW"],
        level: "INTERNAL",
        releasability: ["CIVIL"]
      },
      correlationId,
      entityId: task.taskId,
      entityType: "task",
      payload: {
        task
      },
      producerNodeId: "node_central_cop",
      provenance: task.sourceRef ? [{ sourceRef: task.sourceRef }] : [],
      quality: {
        dataQuality: "observed"
      },
      releasePolicy: {
        allowedScopes: ["internal"],
        visibility: "internal"
      },
      subject: actor.subjectId,
      time: task.updatedAt,
      type
    });
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

  async function deleteCommunityGroup(groupId: string, actor: AuthenticatedActor, requestNow: Date): Promise<boolean> {
    for (const subjectId of actorCommunitySubjectAliases(actor)) {
      try {
        if (await activeCommunityReportStore().deleteGroup(groupId, subjectId, requestNow)) {
          return true;
        }
      } catch (error) {
        markCommunityReportStoreDegraded(error);
        if (await communityReportFallbackStore.deleteGroup(groupId, subjectId, requestNow)) {
          return true;
        }
      }
    }
    return false;
  }

  async function deleteCommunityGroupForDemoScenario(groupId: string, demoScenarioId: string, requestNow: Date): Promise<boolean> {
    try {
      return await activeCommunityReportStore().deleteGroupForDemoScenario(groupId, demoScenarioId, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.deleteGroupForDemoScenario(groupId, demoScenarioId, requestNow);
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

  async function updateCommunityGroupMetadata(input: Parameters<CommunityReportStore["updateGroupMetadata"]>[0], requestNow: Date) {
    try {
      return await activeCommunityReportStore().updateGroupMetadata(input, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.updateGroupMetadata(input, requestNow);
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

  async function validateSketchDrawingWriteScope(
    input: Pick<CreateSketchDrawingInput, "eventId" | "groupId" | "visibility">,
    actor: AuthenticatedActor
  ): Promise<{ code: "FORBIDDEN" | "VALIDATION_ERROR"; message: string; status: 400 | 403 } | null> {
    if (input.visibility === "group") {
      if (!input.groupId) {
        return { code: "VALIDATION_ERROR", message: "Group sketch drawing requires groupId.", status: 400 };
      }
      const group = await readCommunityGroup(input.groupId);
      if (!group || !canUseCommunityGroupForReport(group, actor)) {
        return { code: "FORBIDDEN", message: "Current user cannot publish a sketch drawing into the selected group.", status: 403 };
      }
    }
    if (input.visibility === "event" && !input.eventId) {
      return { code: "VALIDATION_ERROR", message: "Event sketch drawing requires eventId.", status: 400 };
    }
    return null;
  }

  async function validateSketchDrawingUpdateScope(
    input: UpdateSketchDrawingInput,
    current: SketchDrawingFeature,
    actor: AuthenticatedActor
  ): Promise<{ code: "FORBIDDEN" | "VALIDATION_ERROR"; message: string; status: 400 | 403 } | null> {
    const nextVisibility = input.visibility ?? current.properties.visibility;
    const nextGroupId = input.groupId === null ? undefined : input.groupId ?? current.properties.groupId;
    const nextEventId = input.eventId === null ? undefined : input.eventId ?? current.properties.eventId;
    return validateSketchDrawingWriteScope({
      ...(nextEventId ? { eventId: nextEventId } : {}),
      ...(nextGroupId ? { groupId: nextGroupId } : {}),
      visibility: nextVisibility
    }, actor);
  }

  async function listSketchDrawings(query: SketchDrawingQuery): Promise<SketchDrawingFeature[]> {
    try {
      return await activeSketchDrawingStore().list(query);
    } catch (error) {
      markSketchDrawingStoreDegraded(error);
      return sketchDrawingFallbackStore.list(query);
    }
  }

  async function readSketchDrawing(drawingId: string): Promise<SketchDrawingFeature | null> {
    try {
      return await activeSketchDrawingStore().get(drawingId);
    } catch (error) {
      markSketchDrawingStoreDegraded(error);
      return sketchDrawingFallbackStore.get(drawingId);
    }
  }

  async function createSketchDrawing(input: CreateSketchDrawingInput, requestNow: Date): Promise<SketchDrawingFeature> {
    try {
      return await activeSketchDrawingStore().create(input, requestNow);
    } catch (error) {
      markSketchDrawingStoreDegraded(error);
      return sketchDrawingFallbackStore.create(input, requestNow);
    }
  }

  async function updateSketchDrawing(
    drawingId: string,
    actor: AuthenticatedActor,
    input: UpdateSketchDrawingInput,
    requestNow: Date
  ): Promise<SketchDrawingFeature | null> {
    try {
      return await activeSketchDrawingStore().update(drawingId, actorToSketchActor(actor), input, requestNow);
    } catch (error) {
      markSketchDrawingStoreDegraded(error);
      return sketchDrawingFallbackStore.update(drawingId, actorToSketchActor(actor), input, requestNow);
    }
  }

  async function deleteSketchDrawing(drawingId: string, actor: AuthenticatedActor, requestNow: Date): Promise<boolean> {
    try {
      return await activeSketchDrawingStore().delete(drawingId, actorToSketchActor(actor), requestNow);
    } catch (error) {
      markSketchDrawingStoreDegraded(error);
      return sketchDrawingFallbackStore.delete(drawingId, actorToSketchActor(actor), requestNow);
    }
  }

  async function deleteSketchDrawingForDemoScenario(drawingId: string, demoScenarioId: string, actor: AuthenticatedActor, requestNow: Date): Promise<boolean> {
    try {
      return await activeSketchDrawingStore().deleteForDemoScenario(drawingId, demoScenarioId, actorToSketchActor(actor), requestNow);
    } catch (error) {
      markSketchDrawingStoreDegraded(error);
      return sketchDrawingFallbackStore.deleteForDemoScenario(drawingId, demoScenarioId, actorToSketchActor(actor), requestNow);
    }
  }

  async function listFloodDemoObjects(actor: AuthenticatedActor): Promise<{
    drawings: SketchDrawingFeature[];
    groups: CommunityGroupRecord[];
    reports: CommunityReportRecord[];
  }> {
    const groups = (await listCommunityGroups({
      includePublic: true,
      subjectId: actor.subjectId
    })).filter(isFloodDemoGroup);
    const reports = (await listCommunityReports({
      bbox: floodDemoBbox,
      includeOwnDrafts: true,
      limit: 500,
      statuses: ["draft", "submitted", "published"],
      subjectId: actor.subjectId
    })).filter(isFloodDemoReport);
    const actorGroupIds = await readCommunityActorGroupIds(actor);
    for (const group of groups) {
      actorGroupIds.add(group.groupId);
    }
    const drawings = (await listSketchDrawings({
      allowedGroupIds: Array.from(actorGroupIds),
      bbox: floodDemoBbox,
      limit: 500,
      subjectId: actor.subjectId
    })).filter(isFloodDemoDrawing);
    return { drawings, groups, reports };
  }

  function floodDemoStatusPayload(
    objects: {
      drawings: SketchDrawingFeature[];
      groups: CommunityGroupRecord[];
      reports: CommunityReportRecord[];
    },
    requestNow: Date,
    operation?: Record<string, unknown>
  ) {
    return {
      contractVersion: "cop-demo-scenarios-v1",
      generatedAt: requestNow.toISOString(),
      scenario: {
        bbox: floodDemoBbox,
        demoScenarioId: floodDemoScenarioId,
        description: "Předpřipravená ukázka povodňové situace pro PoC a klientskou prezentaci.",
        eventId: floodDemoEventId,
        label: "Povodeň - Středočeský kraj",
        status: objects.groups.length > 0 || objects.reports.length > 0 || objects.drawings.length > 0 ? "ready" : "empty",
        summary: {
          drawingCount: objects.drawings.length,
          groupCount: objects.groups.length,
          reportCount: objects.reports.length
        }
      },
      ...(operation ? { operation } : {})
    };
  }

  async function seedFloodDemoScenario(actor: AuthenticatedActor, requestNow: Date) {
    const before = await listFloodDemoObjects(actor);
    let group = before.groups[0] ?? null;
    const operation = {
      createdDrawings: 0,
      createdGroups: 0,
      createdReports: 0,
      repairedReports: 0
    };
    if (!group) {
      group = await createCommunityGroup({
        anchorLocation: {
          lat: 50.0755,
          lon: 14.4378,
          source: "manual"
        },
        createdBy: actorToCommunityActor(actor),
        description: "Demo skupina pro koordinaci povodňové situace, hlášení z terénu a sdílená média.",
        metadata: floodDemoGroupMetadata(actor),
        name: "DEMO Povodeň - Středočeský kraj",
        visibility: "public"
      }, requestNow);
      operation.createdGroups += 1;
    }
    group = await refreshFloodDemoGroupMetadata(group, actor, requestNow);
    group = await ensureFloodDemoGroupMembers(group, actor, requestNow);

    const reportsByTitle = new Map(before.reports.map((report) => [report.title, report]));
    for (const seed of floodDemoReportSeeds(group.groupId, requestNow)) {
      const existingReport = reportsByTitle.get(seed.title);
      if (existingReport && isFloodDemoReportSeedCurrent(existingReport, seed)) {
        continue;
      }
      if (existingReport) {
        if (await deleteCommunityReportForDemoScenario(existingReport.reportId, floodDemoScenarioId, requestNow)) {
          operation.repairedReports += 1;
        } else {
          app.log.warn({ reportId: existingReport.reportId, title: existingReport.title }, "Demo flood report repair skipped because stale report could not be deleted.");
          continue;
        }
      }
      const report = await createCommunityReport({
        category: seed.category,
        createdBy: actorToCommunityActor(actor),
        description: seed.description,
        location: seed.location,
        observedAt: seed.observedAt,
        properties: seed.properties,
        title: seed.title,
        visibility: seed.visibility
      }, requestNow);
      await submitCommunityReport(report.reportId, actor, requestNow);
      operation.createdReports += 1;
    }

    const drawingLabels = new Set(before.drawings.map((drawing) => drawing.properties.label));
    for (const seed of floodDemoDrawingSeeds(group.groupId)) {
      if (drawingLabels.has(seed.label ?? "")) {
        continue;
      }
      await createSketchDrawing({
        actor: actorToSketchActor(actor),
        eventId: floodDemoEventId,
        geometry: seed.geometry,
        groupId: group.groupId,
        kind: seed.kind,
        label: seed.label,
        locked: false,
        properties: seed.properties,
        style: seed.style,
        symbol: seed.symbol,
        visibility: seed.visibility
      }, requestNow);
      operation.createdDrawings += 1;
    }

    appendAudit(state, "DEMO_SCENARIO_SEEDED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      demoScenarioId: floodDemoScenarioId,
      ...operation
    });
    return floodDemoStatusPayload(await listFloodDemoObjects(actor), requestNow, operation);
  }

  async function refreshFloodDemoGroupMetadata(
    group: CommunityGroupRecord,
    actor: AuthenticatedActor,
    requestNow: Date
  ): Promise<CommunityGroupRecord> {
    const updated = await updateCommunityGroupMetadata({
      actor: actorToCommunityActor(actor),
      groupId: group.groupId,
      metadata: floodDemoGroupMetadata(actor)
    }, requestNow);
    return updated ?? group;
  }

  async function ensureFloodDemoGroupMembers(
    group: CommunityGroupRecord,
    actor: AuthenticatedActor,
    requestNow: Date
  ): Promise<CommunityGroupRecord> {
    let updated = group;
    const profiles = await resolveFloodDemoOperatorProfiles();
    for (const profile of profiles) {
      if (updated.members.some((member) => member.subjectId === profile.subjectId)) {
        continue;
      }
      const next = await upsertCommunityGroupMember({
        actor: actorToCommunityActor(actor),
        groupId: updated.groupId,
        member: {
          displayName: profile.displayName,
          subjectId: profile.subjectId,
          username: profile.username
        },
        role: "member",
        status: "active"
      }, requestNow);
      if (next) {
        updated = next;
      }
    }
    return updated;
  }

  async function resolveFloodDemoOperatorProfiles(): Promise<UserProfileRecord[]> {
    const profilesBySubject = new Map<string, UserProfileRecord>();
    for (const username of floodDemoOperatorUsernames) {
      const matches = await searchUserProfiles(username, 10);
      const exact = matches.find((profile) => profile.username === username || profile.email === username);
      if (exact) {
        profilesBySubject.set(exact.subjectId, exact);
      }
    }
    return Array.from(profilesBySubject.values());
  }

  async function resetFloodDemoScenario(actor: AuthenticatedActor, requestNow: Date) {
    const objects = await listFloodDemoObjects(actor);
    const operation = {
      deletedAuditRecords: 0,
      deletedDrawings: 0,
      deletedGroups: 0,
      deletedReports: 0
    };
    for (const report of objects.reports) {
      if (await deleteCommunityReportForDemoScenario(report.reportId, floodDemoScenarioId, requestNow)) {
        operation.deletedReports += 1;
      }
    }
    for (const drawing of objects.drawings) {
      if (await deleteSketchDrawingForDemoScenario(drawing.id, floodDemoScenarioId, actor, requestNow)) {
        operation.deletedDrawings += 1;
      }
    }
    for (const group of objects.groups) {
      if (await deleteCommunityGroupForDemoScenario(group.groupId, floodDemoScenarioId, requestNow)) {
        operation.deletedGroups += 1;
      }
    }
    const auditCountBefore = state.auditEvents.length;
    state.auditEvents = state.auditEvents.filter((event) => event.demoScenarioId !== floodDemoScenarioId);
    operation.deletedAuditRecords = auditCountBefore - state.auditEvents.length;
    appendAudit(state, "DEMO_SCENARIO_RESET", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      demoScenarioId: floodDemoScenarioId,
      ...operation
    });
    return floodDemoStatusPayload(await listFloodDemoObjects(actor), requestNow, operation);
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

  async function dispatchNotificationDecision(
    actor: AuthenticatedActor | undefined,
    decision: CopNotificationDecision,
    requestNow: Date,
    correlationId: string
  ): Promise<{
    decisionId: string;
    idempotencyKey: string;
    notificationId?: string;
    reason: string;
    status: "degraded" | "disabled" | "online" | "skipped";
    warnings: string[];
  }> {
    if (!decision.shouldSend) {
      appendAudit(state, "NOTIFICATION_DECISION_SKIPPED", {
        decisionId: decision.decisionId,
        reason: decision.reason,
        source: decision.notification.source,
        type: decision.notification.type
      }, correlationId);
      return {
        decisionId: decision.decisionId,
        idempotencyKey: decision.idempotencyKey,
        reason: decision.reason,
        status: "skipped",
        warnings: []
      };
    }

    const result = await messagingProvider.sendNotification(actor, requestNow, decision.idempotencyKey, decision.notification);
    appendAudit(state, "NOTIFICATION_DISPATCH_REQUESTED", {
      decisionId: decision.decisionId,
      idempotencyKey: decision.idempotencyKey,
      notificationId: result.notificationId ?? null,
      providerStatus: result.status,
      source: decision.notification.source,
      type: decision.notification.type
    }, correlationId);
    return {
      decisionId: decision.decisionId,
      idempotencyKey: decision.idempotencyKey,
      ...(result.notificationId ? { notificationId: result.notificationId } : {}),
      reason: decision.reason,
      status: result.status,
      warnings: result.warnings
    };
  }

  async function dispatchCommunityReportNotification(
    actor: AuthenticatedActor,
    report: CommunityReportRecord,
    requestNow: Date,
    correlationId: string
  ): Promise<void> {
    const decision = buildCommunityReportNotificationDecision(report, requestNow);
    await dispatchNotificationDecision(actor, decision, requestNow, correlationId);
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

    const profile = await readUserProfile(actor) ?? await upsertUserProfile({
      alertPreferences: {},
      displayName: actor.displayName,
      ...(actor.email ? { email: actor.email } : {}),
      preferences: {},
      subjectId: actor.subjectId,
      username: actor.username
    });
    return {
      actor,
      alertPreferences: profile?.alertPreferences ?? {},
      preferences: profile?.preferences ?? {},
      updatedAt: profile?.updatedAt ?? null
    };
  });

  app.get("/api/v1/users/search", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const query = request.query as Record<string, unknown>;
    const q = optionalTrimmedString(query.q, 120);
    if (!q || q.length < 2) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "User search requires at least two characters.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const limit = optionalFiniteNumber(query.limit, 1, 25) ?? 10;
    const profiles = await searchUserProfiles(q, limit);
    return {
      contractVersion: "cop-user-directory-v1",
      items: profiles.map(userDirectoryEntry),
      serverTimestamp: now().toISOString()
    };
  });

  app.get("/api/v1/messaging/status", async () => {
    return messagingProvider.fetchStatus(now());
  });

  app.get("/api/v1/push/web/config", async () => {
    return messagingProvider.fetchWebPushConfig(now());
  });

  app.post("/api/v1/push/web/devices", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }

    const registration = normalizeWebPushDeviceRegistrationRequest(request.body);
    if (!registration) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Web push registration requires deviceId, endpoint and browser subscription keys.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const result = await messagingProvider.registerWebPushDevice(actor, now(), registration);
    return reply.code(result.registered ? 202 : result.status === "disabled" ? 503 : 502).send(result);
  });

  app.delete("/api/v1/push/web/devices/:deviceId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { deviceId: string };
    const deviceId = normalizeWebPushDeviceId(params.deviceId);
    if (!deviceId) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Web push device id may contain only A-Z, a-z, 0-9, dot, underscore, equals and dash, with max length 96.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const result = await messagingProvider.deleteWebPushDevice(actor, now(), deviceId);
    return reply.code(result.deleted ? 202 : result.status === "disabled" ? 503 : 502).send(result);
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

  app.get("/api/v1/messaging/conversations/resolve", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const query = isRecord(request.query) ? request.query : {};
    const conversationId = normalizeMessagingConversationId(query.conversationId);
    const roomId = normalizeMatrixRoomId(query.roomId);
    const messageId = optionalTrimmedString(query.messageId, 512);
    if (!conversationId && !roomId) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        messageId
          ? "Message-only conversation resolution is not supported by COP. Deep links must include conversationId or roomId."
          : "Conversation resolution requires conversationId or Matrix roomId.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const result = conversationId
      ? await messagingProvider.fetchConversation(actor, now(), conversationId)
      : await messagingProvider.fetchConversationByRoomId(actor, now(), roomId as string);
    return reply.code(result.conversation ? 200 : result.status === "online" ? 404 : 502).send(result);
  });

  app.get("/api/v1/messaging/conversations/:conversationId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { conversationId: string };
    const conversationId = normalizeMessagingConversationId(params.conversationId);
    if (!conversationId) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Messaging conversation detail requires a valid conversationId.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const result = await messagingProvider.fetchConversation(actor, now(), conversationId);
    return reply.code(result.conversation ? 200 : result.status === "online" ? 404 : 502).send(result);
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

  app.post("/api/v1/notifications/safety/evaluate", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const requestNow = now();
    const body = isRecord(request.body) ? request.body : {};
    const query = normalizeSafetyNotificationEvaluationRequest(body);
    if (!query) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Safety notification evaluation requires bbox=[west,south,east,north].",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const profile = await readUserProfile(actor);
    const collection = await readSafetyMapQuery(query.safetyQuery, requestNow);
    const features = (collection?.features ?? []) as SafetyFeature[];
    const decisions = features.map((feature) =>
      buildSafetyFeatureNotificationDecision(feature, {
        actor,
        audience: query.audience,
        currentLocation: query.currentLocation,
        now: requestNow,
        watchedAreas: profile?.alertPreferences.aoiRules ?? []
      })
    );
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const dispatch = query.dryRun
      ? []
      : await Promise.all(decisions.map((decision) => dispatchNotificationDecision(actor, decision, requestNow, correlationId)));
    return {
      contractVersion: "cop-notification-evaluation-v1",
      decisions,
      dispatch,
      dryRun: query.dryRun,
      query: query.safetyQuery,
      serverTimestamp: requestNow.toISOString(),
      summary: {
        dispatchedCount: dispatch.filter((item) => item.status === "online").length,
        eligibleCount: decisions.filter((decision) => decision.shouldSend).length,
        featureCount: features.length,
        skippedCount: decisions.filter((decision) => !decision.shouldSend).length
      }
    };
  });

  app.get("/api/v1/demo/scenarios", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const requestNow = now();
    const status = floodDemoStatusPayload(await listFloodDemoObjects(actor), requestNow);
    return {
      contractVersion: status.contractVersion,
      generatedAt: status.generatedAt,
      items: [status.scenario]
    };
  });

  app.get("/api/v1/demo/scenarios/:scenarioId/status", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { scenarioId: string };
    if (params.scenarioId !== floodDemoScenarioId) {
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Demo scenario was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    return floodDemoStatusPayload(await listFloodDemoObjects(actor), requestNow);
  });

  app.post("/api/v1/demo/scenarios/:scenarioId/seed", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { scenarioId: string };
    if (params.scenarioId !== floodDemoScenarioId) {
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Demo scenario was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    return seedFloodDemoScenario(actor, now());
  });

  app.post("/api/v1/demo/scenarios/:scenarioId/reset", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { scenarioId: string };
    if (params.scenarioId !== floodDemoScenarioId) {
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Demo scenario was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    return resetFloodDemoScenario(actor, now());
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

  app.patch("/api/v1/community/groups/:groupId/metadata", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { groupId: string };
    const metadata = normalizeCommunityGroupMetadataRequest(request.body);
    if (!metadata) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Community group metadata update requires metadata.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const group = await updateCommunityGroupMetadata({
      actor: actorToCommunityActor(actor),
      groupId: params.groupId,
      metadata
    }, requestNow);
    if (!group) {
      return sendError(reply, 404, "NOT_FOUND", "Community group was not found or cannot be updated by current user.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    appendAudit(state, "COMMUNITY_GROUP_METADATA_UPDATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      groupId: group.groupId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return group;
  });

  app.delete("/api/v1/community/groups/:groupId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { groupId: string };
    const requestNow = now();
    if (!await deleteCommunityGroup(params.groupId, actor, requestNow)) {
      return sendError(reply, 404, "NOT_FOUND", "Community group was not found or cannot be managed by current user.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    appendAudit(state, "COMMUNITY_GROUP_DELETED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      groupId: params.groupId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return reply.code(204).send();
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
    const resolvedMember = await resolveCommunityGroupMemberIdentity(memberRequest, {
      readProfile: readUserProfileBySubject,
      searchProfiles: searchUserProfiles
    });
    if ("error" in resolvedMember) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        resolvedMember.error,
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }

    const requestNow = now();
    const group = await upsertCommunityGroupMember({
      actor: actorToCommunityActor(actor),
      groupId: params.groupId,
      member: {
        displayName: resolvedMember.member.displayName,
        subjectId: resolvedMember.member.subjectId,
        username: resolvedMember.member.username
      },
      role: resolvedMember.member.role,
      status: resolvedMember.member.status
    }, requestNow);
    if (!group) {
      return sendError(reply, 404, "NOT_FOUND", "Community group was not found or cannot be managed by current user.", crypto.randomUUID());
    }
    appendAudit(state, "COMMUNITY_GROUP_MEMBER_UPSERTED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      groupId: group.groupId,
      memberResolution: resolvedMember.resolution,
      memberSubjectId: resolvedMember.member.subjectId,
      status: resolvedMember.member.status
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return group;
  });

  app.get("/api/v1/sketch/palettes", async (request) => {
    const query = request.query as Record<string, unknown>;
    const mode = query.mode === "civil" || query.mode === "professional" ? query.mode : "all";
    return sketchPalettes(mode, now());
  });

  app.get("/api/v1/sketch/drawings", async (request, reply) => {
    const actor = actorFromRequest(request);
    const actorGroupIds = await readCommunityActorGroupIds(actor);
    const query = normalizeSketchDrawingQuery(request.query, actor, actorGroupIds);
    if (!query) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Sketch drawing query accepts bbox=west,south,east,north and optional groupId/eventId.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const drawings = await listSketchDrawings(query);
    return buildSketchDrawingCollection(drawings, query, requestNow);
  });

  app.post("/api/v1/sketch/drawings", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const input = normalizeCreateSketchDrawingRequest(request.body, actor);
    if (!input) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Sketch drawing requires geometry, kind and visibility.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const accessError = await validateSketchDrawingWriteScope(input, actor);
    if (accessError) {
      return sendError(reply, accessError.status, accessError.code, accessError.message, correlationIdFrom(request.headers["x-correlation-id"]));
    }
    const requestNow = now();
    const drawing = await createSketchDrawing(input, requestNow);
    appendAudit(state, "SKETCH_DRAWING_CREATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      drawingId: drawing.id,
      kind: drawing.properties.kind,
      visibility: drawing.properties.visibility
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return reply.code(201).send(drawing);
  });

  app.get("/api/v1/sketch/drawings/:drawingId", async (request, reply) => {
    const actor = actorFromRequest(request);
    const params = request.params as { drawingId: string };
    const drawing = await readSketchDrawing(params.drawingId);
    const actorGroupIds = await readCommunityActorGroupIds(actor);
    if (!drawing || !canReadSketchDrawingResponse(drawing, actor, actorGroupIds)) {
      return sendError(reply, 404, "NOT_FOUND", "Sketch drawing was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    return drawing;
  });

  app.patch("/api/v1/sketch/drawings/:drawingId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { drawingId: string };
    const current = await readSketchDrawing(params.drawingId);
    if (!current || current.properties.ownerSubjectId !== actor.subjectId) {
      return sendError(reply, 404, "NOT_FOUND", "Sketch drawing was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    const input = normalizeUpdateSketchDrawingRequest(request.body);
    if (!input) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Sketch drawing update did not contain any editable field.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const accessError = await validateSketchDrawingUpdateScope(input, current, actor);
    if (accessError) {
      return sendError(reply, accessError.status, accessError.code, accessError.message, correlationIdFrom(request.headers["x-correlation-id"]));
    }
    const requestNow = now();
    const updated = await updateSketchDrawing(params.drawingId, actor, input, requestNow);
    if (!updated) {
      return sendError(reply, 404, "NOT_FOUND", "Sketch drawing was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    appendAudit(state, "SKETCH_DRAWING_UPDATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      drawingId: updated.id,
      revision: updated.properties.revision
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return updated;
  });

  app.delete("/api/v1/sketch/drawings/:drawingId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { drawingId: string };
    const deleted = await deleteSketchDrawing(params.drawingId, actor, now());
    if (!deleted) {
      return sendError(reply, 404, "NOT_FOUND", "Sketch drawing was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    appendAudit(state, "SKETCH_DRAWING_DELETED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      drawingId: params.drawingId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return reply.code(204).send();
  });

  app.get("/api/v1/incidents/fusion/suggestions", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const query = request.query as Record<string, unknown>;
    const bbox = parseBboxQuery(query.bbox);
    const requestNow = now();
    const reports = await listCommunityReports({
      ...(bbox ? { bbox } : {}),
      limit: 500,
      statuses: ["submitted", "published"]
    });
    const readableReports = reports.filter((report) => canReadCommunityReport(report, actor));
    const suggestions = buildIncidentFusionSuggestions(readableReports, requestNow, {
      includeSingletons: query.includeSingletons === "true" || query.includeSingletons === true,
      limit: optionalFiniteNumber(query.limit, 1, 100) ?? 25,
      radiusM: optionalFiniteNumber(query.radiusM, 250, 20000),
      timeWindowSeconds: optionalFiniteNumber(query.timeWindowSeconds, 900, 86400)
    });
    return {
      contractVersion: "cop-incident-fusion-suggestions-v1",
      generatedAt: requestNow.toISOString(),
      items: suggestions,
      sourceReportCount: readableReports.length
    };
  });

  app.get("/api/v1/incidents", async (request, reply) => {
    if (!requireActor(request, reply)) {
      return reply;
    }
    const requestNow = now();
    const query = parseIncidentQuery(request.query as Record<string, unknown>);
    const items = await listIncidents(query);
    return {
      contractVersion: "cop-incidents-v1",
      featureCollection: buildIncidentFeatureCollection(items, query, requestNow),
      items,
      serverTimestamp: requestNow.toISOString()
    };
  });

  app.post("/api/v1/incidents", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const input = normalizeCreateIncidentRequest(request.body, actor);
    if (!input) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Incident requires title, category, severity and location.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const incident = await createIncident(input, requestNow);
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    appendAudit(state, "INCIDENT_CREATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      category: incident.category,
      incidentId: incident.incidentId,
      severity: incident.severity,
      status: incident.status
    }, correlationId);
    await publishIncidentDomainEvent("incident.created", incident, actor, correlationId);
    return reply.code(201).send(incident);
  });

  app.get("/api/v1/incidents/:incidentId", async (request, reply) => {
    if (!requireActor(request, reply)) {
      return reply;
    }
    const params = request.params as { incidentId: string };
    const incident = await readIncident(params.incidentId);
    if (!incident) {
      return sendError(reply, 404, "NOT_FOUND", "Incident was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    return incident;
  });

  app.patch("/api/v1/incidents/:incidentId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { incidentId: string };
    const input = normalizeUpdateIncidentRequest(request.body);
    if (!input) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Incident update did not contain any editable field.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const incident = await updateIncident(params.incidentId, actor, input, requestNow);
    if (!incident) {
      return sendError(reply, 404, "NOT_FOUND", "Incident was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    appendAudit(state, "INCIDENT_UPDATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      incidentId: incident.incidentId,
      status: incident.status
    }, correlationId);
    await publishIncidentDomainEvent("incident.updated", incident, actor, correlationId);
    return incident;
  });

  app.get("/api/v1/incidents/:incidentId/tasks", async (request, reply) => {
    if (!requireActor(request, reply)) {
      return reply;
    }
    const params = request.params as { incidentId: string };
    const incident = await readIncident(params.incidentId);
    if (!incident) {
      return sendError(reply, 404, "NOT_FOUND", "Incident was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    const requestNow = now();
    const query = parseIncidentTaskQuery(params.incidentId, request.query as Record<string, unknown>);
    const items = await listIncidentTasks(query);
    return {
      contractVersion: "cop-incident-tasks-v1",
      incidentId: params.incidentId,
      items,
      serverTimestamp: requestNow.toISOString()
    };
  });

  app.post("/api/v1/incidents/:incidentId/tasks", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { incidentId: string };
    const incident = await readIncident(params.incidentId);
    if (!incident) {
      return sendError(reply, 404, "NOT_FOUND", "Incident was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    const input = normalizeCreateIncidentTaskRequest(params.incidentId, request.body, actor);
    if (!input) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Incident task requires title.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const task = await createIncidentTask(input, requestNow);
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    appendAudit(state, "INCIDENT_TASK_CREATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      incidentId: task.incidentId,
      priority: task.priority,
      status: task.status,
      taskId: task.taskId
    }, correlationId);
    await publishIncidentTaskDomainEvent("task.created", task, actor, correlationId);
    return reply.code(201).send(task);
  });

  app.patch("/api/v1/incidents/:incidentId/tasks/:taskId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { incidentId: string; taskId: string };
    const current = await readIncidentTask(params.taskId);
    if (!current || current.incidentId !== params.incidentId) {
      return sendError(reply, 404, "NOT_FOUND", "Incident task was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    const input = normalizeUpdateIncidentTaskRequest(request.body);
    if (!input) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Incident task update did not contain any editable field.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const task = await updateIncidentTask(params.taskId, actor, input, requestNow);
    if (!task) {
      return sendError(reply, 404, "NOT_FOUND", "Incident task was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    appendAudit(state, "INCIDENT_TASK_UPDATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      incidentId: task.incidentId,
      status: task.status,
      taskId: task.taskId
    }, correlationId);
    if (input.status && input.status !== current.status) {
      await publishIncidentTaskDomainEvent("task.status.changed", task, actor, correlationId);
    }
    return task;
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
    try {
      await dispatchCommunityReportNotification(actor, report, requestNow, correlationIdFrom(request.headers["x-correlation-id"]));
    } catch (error) {
      appendAudit(state, "COMMUNITY_REPORT_NOTIFICATION_FAILED", {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        error: errorMessage(error),
        reportId: report.reportId
      }, correlationIdFrom(request.headers["x-correlation-id"]));
      app.log.warn({ error, reportId: report.reportId }, "Community report notification dispatch failed.");
    }
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

  app.get("/api/v1/map/raster-overlay", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const query = request.query as Record<string, unknown>;
    const requestedUrl = optionalTrimmedString(query.url, 2048);
    const rasterUrl = parseRasterOverlayUrl(requestedUrl, situationDataBaseUrl);
    if (!rasterUrl) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Raster overlay request requires a valid allowlisted raster URL or SIM clean radar path.", correlationId);
    }
    if (!isAllowedRasterOverlayUrl(rasterUrl)) {
      return sendError(reply, 403, "FORBIDDEN", "Raster overlay host is not allowed.", correlationId);
    }

    try {
      const rasterResponse = await fetchRasterOverlay(rasterUrl);
      if (!rasterResponse.ok) {
        return sendError(reply, 502, "UPSTREAM_UNAVAILABLE", `Raster overlay provider returned HTTP ${rasterResponse.status}.`, correlationId);
      }
      const contentType = rasterResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
      if (!contentType.startsWith("image/")) {
        return sendError(reply, 502, "UPSTREAM_INVALID_RESPONSE", "Raster overlay provider did not return an image.", correlationId);
      }

      const contentLength = Number(rasterResponse.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > rasterOverlayMaxBytes) {
        return sendError(reply, 502, "UPSTREAM_INVALID_RESPONSE", "Raster overlay image is too large.", correlationId);
      }
      const body = Buffer.from(await rasterResponse.arrayBuffer());
      if (body.byteLength > rasterOverlayMaxBytes) {
        return sendError(reply, 502, "UPSTREAM_INVALID_RESPONSE", "Raster overlay image is too large.", correlationId);
      }

      const cacheSeconds = readPositiveInteger(process.env.COP_RASTER_OVERLAY_CACHE_SECONDS, 300);
      return reply
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`)
        .header("Content-Type", contentType)
        .send(body);
    } catch (error) {
      app.log.warn({ error, rasterHost: rasterUrl.hostname }, "Raster overlay request failed.");
      return sendError(reply, 502, "UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
    }
  });

  app.get("/api/v1/weather-radar/frames", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const query = request.query as Record<string, unknown>;
    const product = optionalRadarProduct(query.product) ?? "merge1h";
    const hours = boundedQueryInteger(query.hours, 6, 1, 24);
    const limit = boundedQueryInteger(query.limit, 24, 1, 48);
    const cacheSeconds = boundedInteger(readPositiveInteger(process.env.COP_WEATHER_RADAR_FRAMES_CACHE_SECONDS, 120), 60, 300);
    const cacheKey = `${product}:${hours}:${limit}`;
    const requestNowMs = Date.now();
    const cached = weatherRadarFramesCache.get(cacheKey);
    if (cached && cached.expiresAtMs > requestNowMs) {
      return reply
        .header("Cache-Control", `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`)
        .send(cached.body);
    }

    const upstreamUrl = new URL(`${trimTrailingSlash(situationDataBaseUrl)}/weather-radar/frames`);
    upstreamUrl.searchParams.set("product", product);
    upstreamUrl.searchParams.set("hours", String(hours));
    upstreamUrl.searchParams.set("limit", String(limit));

    try {
      const body = await fetchWeatherRadarFrames(upstreamUrl, situationDataSource?.config.timeoutMs);
      weatherRadarFramesCache.set(cacheKey, {
        body,
        expiresAtMs: requestNowMs + cacheSeconds * 1000
      });
      return reply
        .header("Cache-Control", `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`)
        .send(body);
    } catch (error) {
      app.log.warn({ error, upstreamUrl: upstreamUrl.toString() }, "Weather radar frame catalog request failed.");
      return sendError(reply, 502, "UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
    }
  });

  app.get("/api/v1/weather/webcam-proxy", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const query = request.query as Record<string, unknown>;
    const requestedUrl = optionalTrimmedString(query.url, 2048);
    const upstreamUrl = parseWeatherCameraResourceUrl(requestedUrl, situationDataBaseUrl);
    if (!upstreamUrl) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Weather camera proxy requires a valid SIM camera detail or snapshot URL.", correlationId);
    }
    if (!isAllowedWeatherCameraUrl(upstreamUrl)) {
      return sendError(reply, 403, "FORBIDDEN", "Weather camera host is not allowed.", correlationId);
    }

    try {
      const cameraResponse = await fetchWeatherCameraResource(upstreamUrl);
      if (!cameraResponse.ok) {
        return sendError(reply, 502, "UPSTREAM_UNAVAILABLE", `Weather camera provider returned HTTP ${cameraResponse.status}.`, correlationId);
      }
      const contentType = cameraResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
      const isJson = contentType === "application/json" || contentType.endsWith("+json");
      const isImage = contentType.startsWith("image/");
      if (!isJson && !isImage) {
        return sendError(reply, 502, "UPSTREAM_INVALID_RESPONSE", "Weather camera provider did not return JSON or image content.", correlationId);
      }

      const contentLength = Number(cameraResponse.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > weatherCameraMaxBytes) {
        return sendError(reply, 502, "UPSTREAM_INVALID_RESPONSE", "Weather camera response is too large.", correlationId);
      }
      const body = Buffer.from(await cameraResponse.arrayBuffer());
      if (body.byteLength > weatherCameraMaxBytes) {
        return sendError(reply, 502, "UPSTREAM_INVALID_RESPONSE", "Weather camera response is too large.", correlationId);
      }

      const cacheSeconds = isImage
        ? readPositiveInteger(process.env.COP_WEATHER_CAMERA_IMAGE_CACHE_SECONDS, 180)
        : readPositiveInteger(process.env.COP_WEATHER_CAMERA_DETAIL_CACHE_SECONDS, 60);
      return reply
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`)
        .header("Content-Type", contentType)
        .send(body);
    } catch (error) {
      app.log.warn({ error, upstreamUrl: upstreamUrl.toString() }, "Weather camera proxy request failed.");
      return sendError(reply, 502, "UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
    }
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

  app.get("/api/v1/safety/hydro/stations/:stationId/observations", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const requestNow = now();
    const params = request.params as { stationId: string };
    const stationId = optionalTrimmedString(params.stationId, 160);
    if (!stationId) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Hydro station detail requires stationId.", correlationId);
    }
    if (!safetyDataSource?.fetchHydroStationDetail) {
      return sendError(reply, 503, "SOURCE_UNAVAILABLE", "Safety hydro station detail source is disabled.", correlationId);
    }
    const query = parseSafetyHydroStationDetailQuery(request.query as Record<string, unknown>);
    if (!query) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Hydro station detail query supports optional from, to and series=H,Q,TH,H_F,Q_F.", correlationId);
    }
    try {
      return await safetyDataSource.fetchHydroStationDetail(stationId, query, requestNow);
    } catch (error) {
      app.log.warn({ error, stationId }, "Safety hydro station detail failed.");
      return sendError(reply, 502, "SAFETY_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
    }
  });

  async function listFederatedNodes(): Promise<FederatedNodeRecord[]> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        const nodes = await federationRuntimeStore.listNodes();
        state.federatedNodes.clear();
        for (const node of nodes) {
          state.federatedNodes.set(node.nodeId, node);
        }
        return nodes;
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
    return Array.from(state.federatedNodes.values()).sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  }

  async function getFederatedNode(nodeId: string): Promise<FederatedNodeRecord | null> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        const node = await federationRuntimeStore.getNode(nodeId);
        if (node) {
          state.federatedNodes.set(node.nodeId, node);
        }
        return node;
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
    return state.federatedNodes.get(nodeId) ?? null;
  }

  async function upsertFederatedNode(node: FederatedNodeRecord): Promise<void> {
    state.federatedNodes.set(node.nodeId, node);
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        await federationRuntimeStore.upsertNode(node);
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
  }

  async function publishRuntimeDomainEvent(input: DomainEventPublishInput): Promise<DomainEventPublishResult> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        const result = await federationRuntimeStore.publishEvent(input, now());
        if (!state.domainEvents.some((event) => event.id === result.event.id)) {
          state.domainEvents.push(result.event);
        }
        return result;
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
    return publishDomainEventWithResult(state, input, now());
  }

  async function appendRuntimeDomainDeadLetter(input: {
    body: unknown;
    channel?: DomainEventChannel;
    correlationId: string;
    errorCode: string;
    message: string;
    now?: Date;
  }): Promise<DomainDeadLetterRecord> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        const record = await federationRuntimeStore.appendDeadLetter(input);
        if (!state.domainDeadLetters.some((deadLetter) => deadLetter.deadLetterId === record.deadLetterId)) {
          state.domainDeadLetters.push(record);
        }
        return record;
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
    return appendDomainDeadLetter(state, input);
  }

  async function queryRuntimeDomainEvents(query: ReturnType<typeof parseDomainEventReplayQuery>): Promise<DomainEventReplayResult> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        return await federationRuntimeStore.queryEvents(query);
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
    const items = queryDomainEvents(state, query);
    return {
      items,
      totalAvailable: state.domainEvents.length
    };
  }

  async function listRuntimeDomainDeadLetters(limit: number): Promise<DomainDeadLetterQueryResult> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        return await federationRuntimeStore.listDeadLetters(limit);
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
    return {
      items: state.domainDeadLetters.slice(-limit),
      totalAvailable: state.domainDeadLetters.length
    };
  }

  async function getRuntimeDomainDeadLetter(deadLetterId: string): Promise<DomainDeadLetterRecord | null> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        const record = await federationRuntimeStore.getDeadLetter(deadLetterId);
        if (record && !state.domainDeadLetters.some((deadLetter) => deadLetter.deadLetterId === record.deadLetterId)) {
          state.domainDeadLetters.push(record);
        }
        return record;
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
    return state.domainDeadLetters.find((deadLetter) => deadLetter.deadLetterId === deadLetterId) ?? null;
  }

  async function redriveRuntimeDomainDeadLetter(
    deadLetterId: string,
    input: DomainEventPublishInput,
    options: { now?: Date; resolvedBy?: string }
  ): Promise<DomainDeadLetterRedriveResult> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        const result = await federationRuntimeStore.redriveDeadLetter(deadLetterId, input, options);
        if (!state.domainEvents.some((event) => event.id === result.event.id)) {
          state.domainEvents.push(result.event);
        }
        const index = state.domainDeadLetters.findIndex((deadLetter) => deadLetter.deadLetterId === deadLetterId);
        if (index >= 0) {
          state.domainDeadLetters[index] = result.deadLetter;
        } else {
          state.domainDeadLetters.push(result.deadLetter);
        }
        return result;
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }

    const result = publishDomainEventWithResult(state, input, options.now ?? now());
    const timestamp = (options.now ?? now()).toISOString();
    const deadLetter = state.domainDeadLetters.find((item) => item.deadLetterId === deadLetterId);
    if (!deadLetter) {
      throw new Error(`Dead-letter ${deadLetterId} was not found during re-drive.`);
    }
    deadLetter.status = "redriven";
    deadLetter.retryCount = (deadLetter.retryCount ?? 0) + 1;
    deadLetter.retryLastAt = timestamp;
    deadLetter.retryLastEventId = result.event.id;
    deadLetter.resolvedAt ??= timestamp;
    deadLetter.resolvedBy ??= options.resolvedBy;
    return {
      deadLetter,
      event: result.event,
      status: result.duplicate ? "duplicate" : "redriven"
    };
  }

  async function resolveRuntimeDomainDeadLetter(
    deadLetterId: string,
    options: { now?: Date; resolvedBy?: string }
  ): Promise<DomainDeadLetterRecord | null> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        const record = await federationRuntimeStore.resolveDeadLetter(deadLetterId, options);
        if (record) {
          const index = state.domainDeadLetters.findIndex((deadLetter) => deadLetter.deadLetterId === deadLetterId);
          if (index >= 0) {
            state.domainDeadLetters[index] = record;
          } else {
            state.domainDeadLetters.push(record);
          }
        }
        return record;
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
    const deadLetter = state.domainDeadLetters.find((item) => item.deadLetterId === deadLetterId);
    if (!deadLetter) {
      return null;
    }
    const timestamp = (options.now ?? now()).toISOString();
    deadLetter.status = "resolved";
    deadLetter.resolvedAt ??= timestamp;
    deadLetter.resolvedBy ??= options.resolvedBy;
    return deadLetter;
  }

  async function getRuntimeEdgeCursor(nodeId: string): Promise<EdgeReplayCursorRecord | null> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        const cursor = await federationRuntimeStore.getEdgeCursor(nodeId);
        if (cursor) {
          edgeReplayCursors.set(nodeId, cursor);
        }
        return cursor;
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
    return edgeReplayCursors.get(nodeId) ?? null;
  }

  async function updateRuntimeEdgeCursor(input: {
    lastAckedOffset: number;
    nodeId: string;
    now?: Date;
    updatedBy?: string;
  }): Promise<EdgeReplayCursorRecord> {
    if (federationRuntimeStore && federationRuntimeStoreStatus === "ok") {
      try {
        const cursor = await federationRuntimeStore.updateEdgeCursor(input);
        edgeReplayCursors.set(input.nodeId, cursor);
        return cursor;
      } catch (error) {
        markFederationRuntimeStoreDegraded(error);
      }
    }
    const timestamp = (input.now ?? now()).toISOString();
    const previous = edgeReplayCursors.get(input.nodeId);
    const cursor: EdgeReplayCursorRecord = {
      ackedAt: input.lastAckedOffset >= (previous?.lastAckedOffset ?? 0) ? timestamp : previous?.ackedAt ?? timestamp,
      lastAckedOffset: Math.max(previous?.lastAckedOffset ?? 0, input.lastAckedOffset),
      lastReplayAt: timestamp,
      nodeId: input.nodeId,
      ...(input.updatedBy ? { updatedBy: input.updatedBy } : previous?.updatedBy ? { updatedBy: previous.updatedBy } : {})
    };
    edgeReplayCursors.set(input.nodeId, cursor);
    return cursor;
  }

  app.get("/api/v1/federation/nodes", async () => ({
    contractVersion: "cop-federation-node-list-v1",
    generatedAt: now().toISOString(),
    items: await listFederatedNodes()
  }));

  app.get("/api/v1/federation/nodes/:nodeId", async (request, reply) => {
    const params = request.params as { nodeId: string };
    const node = await getFederatedNode(params.nodeId);
    if (!node) {
      return sendError(reply, 404, "NOT_FOUND", "Federated node was not found.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    return node;
  });

  app.post("/api/v1/federation/nodes/:nodeId/heartbeat", async (request, reply) => {
    const params = request.params as { nodeId: string };
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const previous = await getFederatedNode(params.nodeId);
    const result = updateFederatedNodeHeartbeat(state, params.nodeId, request.body, now());
    if (!result.ok || !result.node) {
      return sendError(reply, 400, "VALIDATION_ERROR", result.message ?? "Federated node heartbeat is invalid.", correlationId);
    }
    await upsertFederatedNode(result.node);
    const eventType = result.node.health === "offline"
      ? "node.disconnected"
      : previous?.health === "offline"
        ? "node.reconnected"
        : undefined;
    if (eventType) {
      await publishRuntimeDomainEvent({
        classification: { level: "INTERNAL", releasability: ["CIVIL"] },
        correlationId,
        entityId: result.node.nodeId,
        entityType: "sourceSystem",
        payload: {
          health: result.node.health,
          nodeId: result.node.nodeId,
          nodeName: result.node.nodeName,
          nodeRole: result.node.nodeRole
        },
        producerNodeId: "node_central_cop",
        releasePolicy: { allowedScopes: ["internal"], visibility: "internal" },
        type: eventType
      });
    }
    appendAudit(state, "FEDERATED_NODE_HEARTBEAT", {
      health: result.node.health,
      nodeId: result.node.nodeId,
      nodeRole: result.node.nodeRole
    }, correlationId);
    return reply.code(previous ? 200 : 201).send(result.node);
  });

  app.post("/api/v1/events/domain", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const parsed = parseDomainEventPublishRequest(request.body, correlationId);
    if (!parsed.ok || !parsed.input) {
      await appendRuntimeDomainDeadLetter({
        body: request.body,
        correlationId,
        errorCode: "VALIDATION_ERROR",
        message: parsed.message ?? "Domain event payload does not match contract.",
        now: now()
      });
      appendAudit(state, "DOMAIN_EVENT_REJECTED", {
        reason: "validation"
      }, correlationId);
      return sendError(reply, 400, "VALIDATION_ERROR", parsed.message ?? "Domain event payload does not match contract.", correlationId);
    }
    const producerNode = await getFederatedNode(parsed.input.producerNodeId);
    if (!producerNode) {
      await appendRuntimeDomainDeadLetter({
        body: request.body,
        correlationId,
        errorCode: "UNKNOWN_PRODUCER_NODE",
        message: "Domain event producer node is not registered.",
        now: now()
      });
      appendAudit(state, "DOMAIN_EVENT_REJECTED", {
        producerNodeId: parsed.input.producerNodeId,
        reason: "unknown-producer-node"
      }, correlationId);
      return sendError(reply, 422, "UNKNOWN_PRODUCER_NODE", "Domain event producer node is not registered.", correlationId);
    }
    const { event } = await publishRuntimeDomainEvent(parsed.input);
    appendAudit(state, "DOMAIN_EVENT_PUBLISHED", {
      channel: event.channel,
      eventId: event.id,
      eventType: event.type,
      producerNodeId: event.data.producerNodeId,
      replayOffset: event.replayOffset
    }, correlationId);
    return reply.code(202).send({
      accepted: true,
      channel: event.channel,
      contractVersion: "cop-domain-event-publish-v1",
      correlationId,
      event
    });
  });

  app.post("/api/v1/edge/outbox/flush", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const body = isRecord(request.body) ? request.body : undefined;
    const nodeId = typeof body?.nodeId === "string" ? body.nodeId.trim() : "";
    const events = Array.isArray(body?.events) ? body.events : undefined;
    if (!nodeId || !events) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Edge outbox flush requires nodeId and events array.", correlationId);
    }
    if (events.length > 100) {
      return sendError(reply, 413, "BATCH_TOO_LARGE", "Edge outbox flush supports at most 100 events per request.", correlationId);
    }
    const node = await getFederatedNode(nodeId);
    if (!node || node.nodeRole !== "edge-node") {
      return sendError(reply, 422, "UNKNOWN_EDGE_NODE", "Edge outbox node is not registered as an edge-node.", correlationId);
    }

    const results: EdgeOutboxFlushItemResult[] = [];
    for (const [index, rawEvent] of events.entries()) {
      const rawRecord = isRecord(rawEvent) ? rawEvent : undefined;
      const clientEventId = typeof rawRecord?.clientEventId === "string"
        ? rawRecord.clientEventId.trim()
        : typeof rawRecord?.eventId === "string"
          ? rawRecord.eventId.trim()
          : typeof rawRecord?.id === "string"
            ? rawRecord.id.trim()
            : undefined;
      const normalizedEvent = rawRecord
        ? {
            ...rawRecord,
            id: rawRecord.id ?? rawRecord.eventId ?? rawRecord.clientEventId,
            producerNodeId: nodeId
          }
        : rawEvent;
      const parsed = parseDomainEventPublishRequest(normalizedEvent, correlationId);
      if (!parsed.ok || !parsed.input) {
        await appendRuntimeDomainDeadLetter({
          body: rawEvent,
          channel: "cop.node.sync",
          correlationId,
          errorCode: "VALIDATION_ERROR",
          message: parsed.message ?? "Edge outbox event payload does not match contract.",
          now: now()
        });
        results.push({
          ...(clientEventId ? { clientEventId } : {}),
          errorCode: "VALIDATION_ERROR",
          message: parsed.message ?? `Edge outbox event ${index + 1} is invalid.`,
          status: "rejected"
        });
        continue;
      }
      const published = await publishRuntimeDomainEvent({
        ...parsed.input,
        producerNodeId: nodeId,
        provenance: parsed.input.provenance ?? [
          {
            nodeId,
            observedAt: now().toISOString(),
            source: "edge-outbox"
          }
        ]
      });
      const { duplicate, event } = published;
      results.push({
        ...(clientEventId ? { clientEventId } : {}),
        eventId: event.id,
        replayOffset: event.replayOffset,
        status: duplicate ? "duplicate" : "accepted"
      });
    }

    const acceptedCount = results.filter((item) => item.status === "accepted").length;
    const duplicateCount = results.filter((item) => item.status === "duplicate").length;
    const rejectedCount = results.filter((item) => item.status === "rejected").length;
    appendAudit(state, "EDGE_OUTBOX_FLUSHED", {
      acceptedCount,
      duplicateCount,
      nodeId,
      rejectedCount
    }, correlationId);
    return reply.code(rejectedCount > 0 && acceptedCount === 0 && duplicateCount === 0 ? 207 : 202).send({
      acceptedCount,
      contractVersion: "cop-edge-outbox-flush-v1",
      correlationId,
      duplicateCount,
      generatedAt: now().toISOString(),
      items: results,
      nextOffset: Math.max(0, ...results.map((item) => item.replayOffset ?? 0)),
      nodeId,
      rejectedCount
    });
  });

  app.get("/api/v1/edge/replay-cursors/:nodeId", async (request, reply) => {
    const params = request.params as { nodeId: string };
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const node = await getFederatedNode(params.nodeId);
    if (!node || node.nodeRole !== "edge-node") {
      return sendError(reply, 422, "UNKNOWN_EDGE_NODE", "Replay cursor is available only for registered edge-node.", correlationId);
    }
    const cursor = await getRuntimeEdgeCursor(node.nodeId);
    return {
      contractVersion: "cop-edge-replay-cursor-v1",
      cursor: cursor ?? {
        ackedAt: node.lastSeenAt,
        lastAckedOffset: 0,
        nodeId: node.nodeId
      },
      generatedAt: now().toISOString()
    };
  });

  app.post("/api/v1/edge/replay-cursors/:nodeId/ack", async (request, reply) => {
    const params = request.params as { nodeId: string };
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const node = await getFederatedNode(params.nodeId);
    if (!node || node.nodeRole !== "edge-node") {
      return sendError(reply, 422, "UNKNOWN_EDGE_NODE", "Replay cursor can be acknowledged only by registered edge-node.", correlationId);
    }
    const body = isRecord(request.body) ? request.body : {};
    const offset = Number(body.lastAckedOffset);
    if (!Number.isInteger(offset) || offset < 0) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Replay cursor acknowledgement requires lastAckedOffset as a non-negative integer.", correlationId);
    }
    const actor = actorFromRequest(request);
    const cursor = await updateRuntimeEdgeCursor({
      lastAckedOffset: offset,
      nodeId: node.nodeId,
      now: now(),
      updatedBy: actor?.subjectId ?? "cop-api"
    });
    appendAudit(state, "EDGE_REPLAY_CURSOR_ACKED", {
      actorSubjectId: actor?.subjectId,
      lastAckedOffset: cursor.lastAckedOffset,
      nodeId: node.nodeId
    }, correlationId);
    return {
      contractVersion: "cop-edge-replay-cursor-v1",
      cursor,
      generatedAt: now().toISOString()
    };
  });

  app.get("/api/v1/edge/replay/:nodeId", async (request, reply) => {
    const params = request.params as { nodeId: string };
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const node = await getFederatedNode(params.nodeId);
    if (!node || node.nodeRole !== "edge-node") {
      return sendError(reply, 422, "UNKNOWN_EDGE_NODE", "Replay is available only for registered edge-node.", correlationId);
    }

    const cursor = await getRuntimeEdgeCursor(node.nodeId);
    const query = parseDomainEventReplayQuery({
      ...(request.query as Record<string, unknown>),
      fromOffset: (request.query as Record<string, unknown>).fromOffset ?? cursor?.lastAckedOffset ?? 0
    });
    const result = await queryRuntimeDomainEvents(query);
    const blockedByClassification: string[] = [];
    const blockedByReleasePolicy: string[] = [];
    const items = result.items.filter((event) => {
      const decision = canDeliverDomainEventToNode(event, node);
      if (decision.allowed) {
        return true;
      }
      if (decision.reason === "classification") {
        blockedByClassification.push(event.id);
      } else {
        blockedByReleasePolicy.push(event.id);
      }
      return false;
    });
    const highestScannedOffset = Math.max(query.fromOffset ?? 0, ...result.items.map((event) => event.replayOffset));
    appendAudit(state, "EDGE_DOMAIN_EVENTS_REPLAYED", {
      blockedByClassification: blockedByClassification.length,
      blockedByReleasePolicy: blockedByReleasePolicy.length,
      deliveredCount: items.length,
      fromOffset: query.fromOffset ?? 0,
      highestScannedOffset,
      nodeId: node.nodeId,
      scannedCount: result.items.length
    }, correlationId);
    return {
      contractVersion: "cop-edge-domain-event-replay-v1",
      cursor: cursor ?? {
        ackedAt: node.lastSeenAt,
        lastAckedOffset: 0,
        nodeId: node.nodeId
      },
      generatedAt: now().toISOString(),
      items,
      nextOffset: highestScannedOffset,
      policy: {
        classificationMax: node.classificationMax,
        filteredOut: {
          classification: blockedByClassification.length,
          releasePolicy: blockedByReleasePolicy.length
        },
        nodeId: node.nodeId,
        nodeRole: node.nodeRole
      },
      query,
      summary: {
        count: items.length,
        scanned: result.items.length,
        totalAvailable: result.totalAvailable
      }
    };
  });

  app.get("/api/v1/events/domain", async (request) => {
    const query = parseDomainEventReplayQuery(request.query);
    const result = await queryRuntimeDomainEvents(query);
    const items = result.items;
    return {
      contractVersion: "cop-domain-event-replay-v1",
      generatedAt: now().toISOString(),
      items,
      nextOffset: items.at(-1)?.replayOffset ?? query.fromOffset ?? 0,
      query,
      summary: {
        count: items.length,
        totalAvailable: result.totalAvailable
      }
    };
  });

  app.get("/api/v1/events/dead-letter/:deadLetterId", async (request, reply) => {
    const params = request.params as { deadLetterId: string };
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const deadLetter = await getRuntimeDomainDeadLetter(params.deadLetterId);
    if (!deadLetter) {
      return sendError(reply, 404, "NOT_FOUND", "Domain event dead-letter record was not found.", correlationId);
    }
    return {
      contractVersion: "cop-domain-event-dlq-detail-v1",
      deadLetter,
      generatedAt: now().toISOString()
    };
  });

  app.post("/api/v1/events/dead-letter/:deadLetterId/redrive", async (request, reply) => {
    const params = request.params as { deadLetterId: string };
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const deadLetter = await getRuntimeDomainDeadLetter(params.deadLetterId);
    if (!deadLetter) {
      return sendError(reply, 404, "NOT_FOUND", "Domain event dead-letter record was not found.", correlationId);
    }
    const body = isRecord(request.body) ? request.body : undefined;
    const candidate = body && isRecord(body.event)
      ? body.event
      : body && Object.keys(body).length > 0
        ? body
        : deadLetter.body;
    const parsed = parseDomainEventPublishRequest(candidate, correlationId);
    if (!parsed.ok || !parsed.input) {
      appendAudit(state, "DOMAIN_EVENT_DLQ_REDRIVE_REJECTED", {
        deadLetterId: deadLetter.deadLetterId,
        reason: "validation"
      }, correlationId);
      return sendError(reply, 400, "VALIDATION_ERROR", parsed.message ?? "Dead-letter re-drive event payload does not match contract.", correlationId);
    }
    const producerNode = await getFederatedNode(parsed.input.producerNodeId);
    if (!producerNode) {
      appendAudit(state, "DOMAIN_EVENT_DLQ_REDRIVE_REJECTED", {
        deadLetterId: deadLetter.deadLetterId,
        producerNodeId: parsed.input.producerNodeId,
        reason: "unknown-producer-node"
      }, correlationId);
      return sendError(reply, 422, "UNKNOWN_PRODUCER_NODE", "Dead-letter re-drive producer node is not registered.", correlationId);
    }
    const actor = actorFromRequest(request);
    const result = await redriveRuntimeDomainDeadLetter(deadLetter.deadLetterId, parsed.input, {
      now: now(),
      resolvedBy: actor?.subjectId ?? "cop-api"
    });
    appendAudit(state, "DOMAIN_EVENT_DLQ_REDRIVEN", {
      actorSubjectId: actor?.subjectId,
      deadLetterId: result.deadLetter.deadLetterId,
      eventId: result.event.id,
      replayOffset: result.event.replayOffset,
      status: result.status
    }, correlationId);
    return reply.code(202).send({
      contractVersion: "cop-domain-event-dlq-redrive-v1",
      correlationId,
      deadLetter: result.deadLetter,
      event: result.event,
      generatedAt: now().toISOString(),
      status: result.status
    });
  });

  app.post("/api/v1/events/dead-letter/:deadLetterId/resolve", async (request, reply) => {
    const params = request.params as { deadLetterId: string };
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const actor = actorFromRequest(request);
    const deadLetter = await resolveRuntimeDomainDeadLetter(params.deadLetterId, {
      now: now(),
      resolvedBy: actor?.subjectId ?? "cop-api"
    });
    if (!deadLetter) {
      return sendError(reply, 404, "NOT_FOUND", "Domain event dead-letter record was not found.", correlationId);
    }
    appendAudit(state, "DOMAIN_EVENT_DLQ_RESOLVED", {
      actorSubjectId: actor?.subjectId,
      deadLetterId: deadLetter.deadLetterId
    }, correlationId);
    return {
      contractVersion: "cop-domain-event-dlq-resolve-v1",
      correlationId,
      deadLetter,
      generatedAt: now().toISOString()
    };
  });

  app.get("/api/v1/events/dead-letter", async (request) => {
    const query = request.query as { limit?: string };
    const parsedLimit = Number.parseInt(query.limit ?? "", 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
    const result = await listRuntimeDomainDeadLetters(limit);
    return {
      contractVersion: "cop-domain-event-dlq-v1",
      generatedAt: now().toISOString(),
      items: result.items,
      summary: {
        count: result.items.length,
        totalAvailable: result.totalAvailable
      }
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

  app.post("/api/v1/ai/situation-summary", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const requestNow = now();
    const body = isRecord(request.body) ? request.body : {};
    const subject = defaultSystemSubject();
    const maxObjects = readBoundedInteger(body.maxObjects, 40, 1, 80);
    const includeAlerts = body.includeAlerts !== false;
    const readableObjects = selectCurrentTracks(state.objects.values(), requestNow, trackLifecycle)
      .filter((object) => canReadObject(subject, object))
      .slice(0, maxObjects);
    const decoratedObjects = await decorateObjectsWithConflictEvidence(readableObjects, requestNow);
    const sourceHealth = buildSourceHealthItems(state, requestNow, trackLifecycle);
    const alerts = includeAlerts
      ? (await buildAlertItems({
          actor,
          includeAcknowledged: false,
          includeExpired: false,
          requestNow
        })).slice(0, 25)
      : [];
    const aiRequest: AiCopQuery = {
      requestId: aiRequestId(body.requestId),
      purpose: "COP_EXPLANATION",
      prompt: [
        `Vytvoř stručný situační souhrn pro civilní mapu v jazyce ${aiLanguage(body.language)}.`,
        "Odděl ověřená data, modelované odhady a chybějící informace.",
        "Nepřidávej vlastní fakta a neformuluj operační pokyny."
      ].join(" "),
      context: {
        contractVersion: "cop-ai-situation-summary-v1",
        generatedAt: requestNow.toISOString(),
        scope: {
          objectCount: readableObjects.length,
          alertCount: alerts.length,
          sourceCount: sourceHealth.length
        },
        objects: decoratedObjects.map(summarizeObjectForAi),
        alerts: alerts.map(summarizeAlertForAi),
        sourceHealth: sourceHealth.map(summarizeSourceHealthForAi)
      },
      providerPreference: "auto",
      outputFormat: "MARKDOWN",
      safetyScope: "COP_DATA_ASSISTANCE_ONLY"
    };
    const response = await aiGateway.queryCopAssistant(aiRequest);
    appendAudit(state, `AI_SITUATION_SUMMARY_${response.status}`, aiAuditMetadata(response, actor), correlationId);
    return response;
  });

  app.post("/api/v1/ai/source-health-summary", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const requestNow = now();
    const body = isRecord(request.body) ? request.body : {};
    const sourceHealth = buildSourceHealthItems(state, requestNow, trackLifecycle);
    const aiRequest: AiCopQuery = {
      requestId: aiRequestId(body.requestId),
      purpose: "DATA_QUALITY_CHECK",
      prompt: [
        `Vysvětli stav datových zdrojů pro civilního operátora v jazyce ${aiLanguage(body.language)}.`,
        "Piš srozumitelně, bez interních tokenů, bez stack trace a bez strašení občana.",
        "Uveď, které vrstvy mohou být neúplné nebo starší."
      ].join(" "),
      context: {
        contractVersion: "cop-ai-source-health-summary-v1",
        generatedAt: requestNow.toISOString(),
        sources: sourceHealth.map(summarizeSourceHealthForAi)
      },
      providerPreference: "auto",
      outputFormat: "MARKDOWN",
      safetyScope: "COP_DATA_ASSISTANCE_ONLY"
    };
    const response = await aiGateway.queryCopAssistant(aiRequest);
    appendAudit(state, `AI_SOURCE_HEALTH_SUMMARY_${response.status}`, aiAuditMetadata(response, actor), correlationId);
    return response;
  });

  app.post("/api/v1/ai/community-report/draft", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const body = isRecord(request.body) ? request.body : {};
    const aiRequest: AiCopQuery = {
      requestId: aiRequestId(body.requestId),
      purpose: "REPORT_DRAFT",
      prompt: [
        `Pomoz upravit civilní hlášení v jazyce ${aiLanguage(body.language)}.`,
        "Vrať stručný název, popis, navrženou kategorii, stupeň rizika a otázky na chybějící údaje.",
        "Nečti média, nevymýšlej chybějící fakta a neopakuj osobní údaje."
      ].join(" "),
      context: {
        contractVersion: "cop-ai-community-report-draft-v1",
        category: optionalText(body.category),
        description: optionalText(body.description)?.slice(0, 2000),
        hazardSeverity: optionalText(body.hazardSeverity),
        language: aiLanguage(body.language),
        location: summarizeLocationForAi(body.location),
        title: optionalText(body.title)?.slice(0, 200)
      },
      providerPreference: "auto",
      outputFormat: "JSON",
      safetyScope: "COP_DATA_ASSISTANCE_ONLY"
    };
    const response = await aiGateway.queryCopAssistant(aiRequest);
    appendAudit(state, `AI_COMMUNITY_REPORT_DRAFT_${response.status}`, aiAuditMetadata(response, actor), correlationId);
    return response;
  });

  async function invokeCopMcpToolInternal(
    tool: CopMcpToolDefinition,
    input: Record<string, unknown>,
    actor: AuthenticatedActor | null | undefined,
    correlationId: string
  ): Promise<CopMcpToolInvocationEnvelope> {
    const startedAt = Date.now();
    const invocationId = crypto.randomUUID();
    let result: Record<string, unknown>;

    switch (tool.toolId) {
      case "cop.area.summary": {
        result = await buildCopAreaSummaryToolResult(input, actor ?? null, invocationId);
        break;
      }
      case "cop.fusion.explain": {
        result = await buildCopAreaFusionToolResult(input, actor ?? null, invocationId);
        break;
      }
      case "cop.federation.nodes.list": {
        const nodes = await listFederatedNodes();
        result = {
          contractVersion: "cop-federation-node-list-v1",
          generatedAt: now().toISOString(),
          items: nodes,
          summary: {
            count: nodes.length
          }
        };
        break;
      }
      case "cop.sources.health": {
        result = buildCopSourcesHealthToolResult(input);
        break;
      }
      case "cop.events.replay": {
        const query = parseDomainEventReplayQuery(input);
        const replay = await queryRuntimeDomainEvents(query);
        const items = replay.items;
        result = {
          contractVersion: "cop-domain-event-replay-v1",
          generatedAt: now().toISOString(),
          items,
          nextOffset: items.at(-1)?.replayOffset ?? query.fromOffset ?? 0,
          query,
          summary: {
            count: items.length,
            totalAvailable: replay.totalAvailable
          }
        };
        break;
      }
      case "cop.events.dead_letters.list": {
        const requestedLimit = Number(input.limit);
        const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 50;
        const deadLetters = await listRuntimeDomainDeadLetters(limit);
        result = {
          contractVersion: "cop-domain-event-dlq-v1",
          generatedAt: now().toISOString(),
          items: deadLetters.items,
          summary: {
            count: deadLetters.items.length,
            totalAvailable: deadLetters.totalAvailable
          }
        };
        break;
      }
      case "cop.audit.events.list": {
        const requestedLimit = Number(input.limit);
        const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 50;
        const items = state.auditEvents.slice(-limit);
        result = {
          contractVersion: "cop-audit-event-list-v1",
          generatedAt: now().toISOString(),
          items,
          summary: {
            count: items.length,
            totalAvailable: state.auditEvents.length
          }
        };
        break;
      }
    }

    const durationMs = Date.now() - startedAt;
    appendAudit(state, "MCP_TOOL_INVOKED", {
      actorSubjectId: actor?.subjectId,
      durationMs,
      invocationId,
      mode: tool.mode,
      status: "ok",
      toolId: tool.toolId
    }, correlationId);
    await publishRuntimeDomainEvent({
      channel: "cop.ai.audit",
      classification: {
        handlingCaveats: ["NO_PLAINTEXT_MESSAGES", "NO_PROVIDER_TOKENS"],
        level: "INTERNAL",
        releasability: ["CIVIL"]
      },
      correlationId,
      entityId: invocationId,
      entityType: "auditRecord",
      payload: {
        actorSubjectId: actor?.subjectId,
        durationMs,
        mode: tool.mode,
        status: "ok",
        toolId: tool.toolId
      },
      producerNodeId: "node_central_cop",
      quality: {
        dataQuality: "observed"
      },
      releasePolicy: {
        allowedScopes: ["internal"],
        visibility: "internal"
      },
      type: "ai.tool.invoked"
    });
    return {
      contractVersion: "cop-mcp-tool-invocation-v1",
      generatedAt: now().toISOString(),
      invocationId,
      result,
      status: "ok",
      tool: {
        mode: tool.mode,
        toolId: tool.toolId,
        title: tool.title
      }
    };
  }

  async function buildCopAreaSummaryToolResult(
    input: Record<string, unknown>,
    actor: AuthenticatedActor | null,
    invocationId: string
  ): Promise<Record<string, unknown>> {
    const requestNow = now();
    const query = normalizeCopAreaSummaryMapRequest(input);
    const includePartner = Boolean(actor) && query.includePartner;
    const providers = await readMapCatalogProviders(requestNow, actor, includePartner);
    const catalog = buildMapCatalog({
      flight: providers.flight,
      generatedAt: requestNow,
      includeDiagnostics: false,
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

    return buildCopAreaSummaryPayload({
      bbox: query.bbox,
      collections: [
        areaSummaryProviderSlice("situation", "SIM situation", situationCollection),
        areaSummaryProviderSlice("safety", "SIM safety", safetyCollection),
        areaSummaryProviderSlice("flight", "SIM flight reference", flightCollection),
        areaSummaryProviderSlice("community", "COP community reports", communityCollection),
        areaSummaryProviderSlice("missionArena", "Mission Arena", missionArenaCollection),
        areaSummaryProviderSlice("tak", "TAK Gateway", takCollection)
      ],
      generatedAt: requestNow.toISOString(),
      invocationId,
      layerIds: selectedLayers.map((layer) => layer.layerId),
      requestedLayerIds: query.layerIds,
      warnings
    });
  }

  async function buildCopAreaFusionToolResult(
    input: Record<string, unknown>,
    actor: AuthenticatedActor | null,
    invocationId: string
  ): Promise<Record<string, unknown>> {
    const areaSummary = await buildCopAreaSummaryToolResult(input, actor, invocationId);
    return buildCopAreaFusionPayload({
      areaSummary,
      generatedAt: now().toISOString(),
      invocationId,
      priorityLimit: optionalFiniteNumber(input.priorityLimit, 1, 20) ?? 8
    });
  }

  function buildCopSourcesHealthToolResult(input: Record<string, unknown>): Record<string, unknown> {
    const requestNow = now();
    const includeDisabled = parseBooleanQuery(input.includeDisabled);
    const healthFilter = optionalString(input.health, ["DEGRADED", "DISABLED", "ONLINE", "QUIET", "STALE", "UNAVAILABLE", "WAITING"]);
    const items = buildSourceHealthItems(state, requestNow, trackLifecycle)
      .filter((item) => includeDisabled || item.health !== "DISABLED")
      .filter((item) => !healthFilter || item.health === healthFilter)
      .sort(compareSourceHealthItems);
    return {
      contractVersion: "cop-source-health-v1",
      generatedAt: requestNow.toISOString(),
      items,
      query: {
        ...(healthFilter ? { health: healthFilter } : {}),
        includeDisabled
      },
      summary: buildSourceHealthSummary(items)
    };
  }

  app.get("/api/v1/mcp", async () => ({
    contractVersion: "cop-mcp-http-server-v1",
    generatedAt: now().toISOString(),
    methods: ["initialize", "notifications/initialized", "ping", "tools/list", "tools/call"],
    protocolVersion: "2025-06-18",
    summary: {
      toolCount: copMcpTools.length,
      transport: "streamable-http-json-rpc"
    },
    toolsEndpoint: "/api/v1/mcp/tools"
  }));

  app.post("/api/v1/mcp", async (request, reply) => {
    const body = request.body;
    const isBatch = Array.isArray(body);
    const messages = isBatch ? body : [body];
    if (isBatch && messages.length === 0) {
      return reply.code(400).send(mcpJsonRpcError(null, -32600, "Invalid Request", "JSON-RPC batch cannot be empty."));
    }

    const actor = actorFromRequest(request);
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const responses: Record<string, unknown>[] = [];

    for (const message of messages) {
      const response = await handleMcpJsonRpcMessage(message, actor, correlationId);
      if (response) {
        responses.push(response);
      }
    }

    if (responses.length === 0) {
      return reply.code(204).send();
    }

    return isBatch ? responses : responses[0];
  });

  async function handleMcpJsonRpcMessage(
    message: unknown,
    actor: AuthenticatedActor | null | undefined,
    correlationId: string
  ): Promise<Record<string, unknown> | undefined> {
    if (!isRecord(message)) {
      return mcpJsonRpcError(null, -32600, "Invalid Request", "MCP message must be a JSON object.");
    }

    const id = "id" in message ? mcpJsonRpcId(message.id) : undefined;
    if ("id" in message && id === undefined) {
      return mcpJsonRpcError(null, -32600, "Invalid Request", "JSON-RPC id must be a string, number or null.");
    }
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return id === undefined ? undefined : mcpJsonRpcError(id, -32600, "Invalid Request", "Expected JSON-RPC 2.0 MCP request.");
    }
    if (id === undefined && message.method !== "notifications/initialized") {
      return undefined;
    }

    switch (message.method) {
      case "initialize":
        return mcpJsonRpcResult(id, {
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          instructions:
            "Use only the advertised read-only COP tools. Tool calls are audited in COP and never expose provider tokens, plaintext chat payloads or arbitrary command execution.",
          protocolVersion: "2025-06-18",
          serverInfo: {
            name: "csm-cop-mcp",
            title: "CSM COP MCP Gateway",
            version: "1.0.0"
          }
        });
      case "notifications/initialized":
        return undefined;
      case "ping":
        return mcpJsonRpcResult(id, {});
      case "tools/list":
        return mcpJsonRpcResult(id, {
          tools: copMcpTools.map((tool) => ({
            annotations: {
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
              readOnlyHint: true
            },
            description: tool.description,
            inputSchema: tool.inputSchema,
            name: tool.toolId,
            title: tool.title
          }))
        });
      case "tools/call": {
        const params = isRecord(message.params) ? message.params : {};
        const toolName = typeof params.name === "string" ? params.name : "";
        const tool = copMcpTools.find((item) => item.toolId === toolName);
        if (!tool) {
          return mcpJsonRpcError(id, -32602, "Invalid params", "Requested COP MCP tool is not allowlisted.");
        }
        const input = isRecord(params.arguments) ? params.arguments : {};
        const invocation = await invokeCopMcpToolInternal(tool, input, actor, correlationId);
        return mcpJsonRpcResult(id, {
          content: [
            {
              text: JSON.stringify(invocation.result, null, 2),
              type: "text"
            }
          ],
          isError: false,
          structuredContent: invocation.result
        });
      }
      default:
        return mcpJsonRpcError(id, -32601, "Method not found", `Unsupported MCP method: ${message.method}`);
    }
  }

  app.get("/api/v1/mcp/tools", async () => ({
    contractVersion: "cop-mcp-tool-registry-v1",
    generatedAt: now().toISOString(),
    items: copMcpTools,
    summary: {
      count: copMcpTools.length
    }
  }));

  app.post("/api/v1/mcp/tools/:toolId/invoke", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const params = request.params as { toolId: string };
    const tool = copMcpTools.find((item) => item.toolId === params.toolId);
    if (!tool) {
      return sendError(reply, 404, "NOT_FOUND", "COP MCP tool was not found.", correlationId);
    }

    const body = isRecord(request.body) ? request.body : {};
    const input = isRecord(body.input) ? body.input : body;
    return invokeCopMcpToolInternal(tool, input, actorFromRequest(request), correlationId);
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
      const [catalog, layers, sources, observability] = await Promise.all([
        safetyDataSource.fetchCatalog ? safetyDataSource.fetchCatalog(requestNow) : Promise.resolve(undefined),
        safetyDataSource.fetchLayers(requestNow),
        safetyDataSource.fetchSources(requestNow),
        readSafetyObservability(requestNow)
      ]);
      const health = buildSafetyDataHealth(layers, requestNow, observability);
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

  async function readSafetyObservability(requestNow: Date) {
    if (!safetyDataSource?.fetchObservability) {
      return undefined;
    }
    try {
      return await safetyDataSource.fetchObservability(requestNow);
    } catch (error) {
      app.log.warn({ error }, "Safety data observability request failed.");
      return undefined;
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
      const [collection, observability] = await Promise.all([
        safetyDataSource.fetchFeatures(query, requestNow),
        readSafetyObservability(requestNow)
      ]);
      const health = buildSafetyDataHealth(collection, requestNow, observability);
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

const copAreaSummaryDefaultLayerIds = [
  "public.safety.flood",
  "public.safety.weather_alerts",
  "public.safety.warnings",
  "user.community.reports",
  "public.weather.webcams",
  "public.mobile.network"
];

type AreaSummarySeverity = "advisory" | "critical" | "info" | "warning";

interface AreaSummaryLocation {
  lat: number;
  lon: number;
}

interface AreaSummaryFeatureCandidate {
  category?: string;
  confidence?: number;
  detail?: string;
  featureId?: string;
  label: string;
  layer?: string;
  location?: AreaSummaryLocation;
  observedAt?: string;
  providerId: string;
  severity: AreaSummarySeverity;
  sourceId?: string;
  stale: boolean;
  validUntil?: string;
}

interface AreaSummaryProviderSlice {
  featureCount: number;
  generatedAt?: string;
  health?: SourceHealthOverride["health"];
  label: string;
  notableFeatures: AreaSummaryFeatureCandidate[];
  providerId: string;
  sourceCount: number;
  sourceIds: string[];
  staleFeatureCount: number;
  warningCount: number;
  warnings: string[];
}

interface CopAreaSummaryPayloadInput {
  bbox: MapFeatureQueryRequest["bbox"];
  collections: Array<AreaSummaryProviderSlice | undefined>;
  generatedAt: string;
  invocationId: string;
  layerIds: string[];
  requestedLayerIds: string[];
  warnings: string[];
}

function normalizeCopAreaSummaryMapRequest(input: Record<string, unknown>): MapFeatureQueryRequest {
  const bbox = parseMapQueryBbox(input.bbox) ?? floodDemoBbox;
  const layerIds = normalizeMapQueryStringList(input.layerIds ?? input.layers);
  return {
    bbox,
    filters: normalizeMapQueryFilters(input.filters),
    includeDiagnostics: false,
    includePartner: parseBooleanQuery(input.includePartner),
    layerIds: layerIds.length > 0 ? layerIds : copAreaSummaryDefaultLayerIds,
    limit: optionalFiniteNumber(input.limit, 1, 500) ?? 250
  };
}

function areaSummaryProviderSlice(
  providerId: string,
  label: string,
  collection: unknown
): AreaSummaryProviderSlice | undefined {
  if (!isRecord(collection)) {
    return undefined;
  }
  const features = Array.isArray(collection.features) ? collection.features : [];
  const warnings = areaSummaryStringArray(collection.warnings);
  const sourceIds = areaSummarySourceIds(collection.sources);
  const sourceHealth = isRecord(collection.sourceHealth) ? collection.sourceHealth : undefined;
  const featureCount = areaSummarySummaryNumber(collection, "featureCount", features.length);
  const staleFeatureCount = areaSummarySummaryNumber(
    collection,
    "staleFeatureCount",
    features.filter((feature) => areaSummaryFeatureProperties(feature).stale === true).length
  );
  const warningCount = areaSummarySummaryNumber(collection, "warningCount", warnings.length);
  return {
    featureCount,
    generatedAt: optionalTrimmedString(collection.generatedAt, 80),
    health: isSourceHealthOverride(sourceHealth?.health) ? sourceHealth.health : undefined,
    label,
    notableFeatures: features.flatMap((feature) => areaSummaryFeatureCandidate(providerId, feature)).slice(0, 25),
    providerId,
    sourceCount: areaSummarySummaryNumber(collection, "sourceCount", sourceIds.length),
    sourceIds,
    staleFeatureCount,
    warningCount,
    warnings: warnings.slice(0, 10)
  };
}

function buildCopAreaSummaryPayload(input: CopAreaSummaryPayloadInput): Record<string, unknown> {
  const providerSlices = input.collections.filter((item): item is AreaSummaryProviderSlice => Boolean(item));
  const allCandidates = providerSlices
    .flatMap((slice) => slice.notableFeatures)
    .sort(compareAreaSummaryFeatureCandidates);
  const notableFeatures = allCandidates.slice(0, 12);
  const sourceIds = Array.from(new Set(providerSlices.flatMap((slice) => slice.sourceIds))).sort();
  const featureCount = providerSlices.reduce((sum, slice) => sum + slice.featureCount, 0);
  const staleFeatureCount = providerSlices.reduce((sum, slice) => sum + slice.staleFeatureCount, 0);
  const providerWarnings = providerSlices.flatMap((slice) => slice.warnings.map((warning) => `${slice.label}: ${warning}`));
  const uncertainties = Array.from(new Set([
    ...input.warnings,
    ...providerWarnings,
    ...providerSlices.flatMap((slice) => slice.health && slice.health !== "ONLINE" ? [`${slice.label} health is ${slice.health}.`] : [])
  ])).slice(0, 20);
  const criticalCount = allCandidates.filter((feature) => feature.severity === "critical").length;
  const warningCount = allCandidates.filter((feature) => feature.severity === "warning").length;
  return {
    audit: {
      eventType: "ai.tool.invoked",
      invocationId: input.invocationId
    },
    confidence: areaSummaryConfidence(featureCount, staleFeatureCount, uncertainties.length, providerSlices),
    contractVersion: "cop-area-summary-v1",
    generatedAt: input.generatedAt,
    headline: areaSummaryHeadline(featureCount, notableFeatures),
    notableFeatures,
    scope: {
      bbox: input.bbox,
      layerIds: input.layerIds,
      requestedLayerIds: input.requestedLayerIds
    },
    sources: providerSlices.map((slice) => ({
      featureCount: slice.featureCount,
      generatedAt: slice.generatedAt,
      health: slice.health ?? "UNKNOWN",
      label: slice.label,
      providerId: slice.providerId,
      sourceCount: slice.sourceCount,
      sourceIds: slice.sourceIds,
      staleFeatureCount: slice.staleFeatureCount,
      warningCount: slice.warningCount
    })),
    summary: {
      criticalCount,
      featureCount,
      providerCount: providerSlices.length,
      sourceCount: sourceIds.length,
      staleFeatureCount,
      uncertaintyCount: uncertainties.length,
      warningCount
    },
    uncertainties
  };
}

function areaSummaryFeatureCandidate(providerId: string, feature: unknown): AreaSummaryFeatureCandidate[] {
  const properties = areaSummaryFeatureProperties(feature);
  const label = areaSummaryText(properties, ["headline", "label", "title", "name", "areaName", "sourceName", "featureId"]);
  if (!label) {
    return [];
  }
  const severity = normalizeAreaSummarySeverity(properties.severity ?? properties.hazardSeverity ?? properties.floodStage ?? properties.status);
  const location = areaSummaryFeatureLocation(feature, properties);
  return [{
    ...(areaSummaryText(properties, ["category"]) ? { category: areaSummaryText(properties, ["category"]) } : {}),
    ...(optionalFiniteNumber(properties.confidence, 0, 1) !== undefined ? { confidence: optionalFiniteNumber(properties.confidence, 0, 1) } : {}),
    ...(areaSummaryText(properties, ["recommendedAction", "description", "summary"], 240) ? { detail: areaSummaryText(properties, ["recommendedAction", "description", "summary"], 240) } : {}),
    ...(areaSummaryText(properties, ["featureId", "reportId", "stationId"], 160) ? { featureId: areaSummaryText(properties, ["featureId", "reportId", "stationId"], 160) } : {}),
    label,
    ...(areaSummaryText(properties, ["layer", "layerId"], 120) ? { layer: areaSummaryText(properties, ["layer", "layerId"], 120) } : {}),
    ...(location ? { location } : {}),
    ...(areaSummaryText(properties, ["observedAt", "updatedAt", "effectiveAt", "validFrom"], 80) ? { observedAt: areaSummaryText(properties, ["observedAt", "updatedAt", "effectiveAt", "validFrom"], 80) } : {}),
    providerId,
    severity,
    ...(areaSummaryText(properties, ["sourceId", "source"], 120) ? { sourceId: areaSummaryText(properties, ["sourceId", "source"], 120) } : {}),
    stale: properties.stale === true,
    ...(areaSummaryText(properties, ["validUntil", "expiresAt", "forecastUntil"], 80) ? { validUntil: areaSummaryText(properties, ["validUntil", "expiresAt", "forecastUntil"], 80) } : {})
  }];
}

function areaSummaryFeatureProperties(feature: unknown): Record<string, unknown> {
  return isRecord(feature) && isRecord(feature.properties) ? feature.properties : {};
}

function areaSummaryFeatureLocation(feature: unknown, properties: Record<string, unknown>): AreaSummaryLocation | undefined {
  const propertyLocation = areaSummaryLocationFromProperties(properties);
  if (propertyLocation) {
    return propertyLocation;
  }
  if (!isRecord(feature) || !isRecord(feature.geometry)) {
    return undefined;
  }
  const geometry = feature.geometry;
  const type = optionalTrimmedString(geometry.type, 40);
  if (type === "Point") {
    return areaSummaryCoordinatePair(geometry.coordinates);
  }
  const pairs = areaSummaryCoordinatePairs(geometry.coordinates);
  if (pairs.length === 0) {
    return undefined;
  }
  const sum = pairs.reduce(
    (accumulator, pair) => ({
      lat: accumulator.lat + pair.lat,
      lon: accumulator.lon + pair.lon
    }),
    { lat: 0, lon: 0 }
  );
  return {
    lat: Math.round((sum.lat / pairs.length) * 1_000_000) / 1_000_000,
    lon: Math.round((sum.lon / pairs.length) * 1_000_000) / 1_000_000
  };
}

function areaSummaryLocationFromProperties(properties: Record<string, unknown>): AreaSummaryLocation | undefined {
  const lat = optionalFiniteNumber(properties.lat ?? properties.latitude, -90, 90);
  const lon = optionalFiniteNumber(properties.lon ?? properties.lng ?? properties.longitude, -180, 180);
  if (lat !== undefined && lon !== undefined) {
    return { lat, lon };
  }
  const location = isRecord(properties.location) ? properties.location : undefined;
  const nestedLat = optionalFiniteNumber(location?.lat ?? location?.latitude, -90, 90);
  const nestedLon = optionalFiniteNumber(location?.lon ?? location?.lng ?? location?.longitude, -180, 180);
  return nestedLat !== undefined && nestedLon !== undefined ? { lat: nestedLat, lon: nestedLon } : undefined;
}

function areaSummaryCoordinatePair(value: unknown): AreaSummaryLocation | undefined {
  if (!Array.isArray(value) || value.length < 2) {
    return undefined;
  }
  const lon = optionalFiniteNumber(value[0], -180, 180);
  const lat = optionalFiniteNumber(value[1], -90, 90);
  return lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
}

function areaSummaryCoordinatePairs(value: unknown): AreaSummaryLocation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const pair = areaSummaryCoordinatePair(value);
  if (pair) {
    return [pair];
  }
  return value.flatMap((item) => areaSummaryCoordinatePairs(item)).slice(0, 500);
}

function areaSummaryText(properties: Record<string, unknown>, keys: string[], maxLength = 180): string | undefined {
  for (const key of keys) {
    const value = optionalTrimmedString(properties[key], maxLength);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeAreaSummarySeverity(value: unknown): AreaSummarySeverity {
  if (typeof value === "number") {
    return value >= 3 ? "critical" : value === 2 ? "warning" : value === 1 ? "advisory" : "info";
  }
  const text = optionalTrimmedString(value, 80)?.toLowerCase() ?? "";
  if (["critical", "severe", "danger", "emergency", "alarm"].some((item) => text.includes(item))) {
    return "critical";
  }
  if (["warning", "warn", "high", "orange"].some((item) => text.includes(item))) {
    return "warning";
  }
  if (["advisory", "watch", "moderate", "yellow"].some((item) => text.includes(item))) {
    return "advisory";
  }
  return "info";
}

function compareAreaSummaryFeatureCandidates(a: AreaSummaryFeatureCandidate, b: AreaSummaryFeatureCandidate): number {
  const severityDelta = areaSummarySeverityRank(b.severity) - areaSummarySeverityRank(a.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  if (a.stale !== b.stale) {
    return a.stale ? 1 : -1;
  }
  return (b.confidence ?? 0) - (a.confidence ?? 0);
}

function areaSummarySeverityRank(value: AreaSummarySeverity): number {
  return value === "critical" ? 4 : value === "warning" ? 3 : value === "advisory" ? 2 : 1;
}

function areaSummaryHeadline(featureCount: number, notableFeatures: AreaSummaryFeatureCandidate[]): string {
  if (featureCount === 0) {
    return "Ve vybrané oblasti nejsou v dostupných vrstvách aktivní objekty.";
  }
  const top = notableFeatures[0];
  if (!top) {
    return `Ve vybrané oblasti je ${featureCount} dostupných objektů bez výrazné priority.`;
  }
  return top.severity === "critical" || top.severity === "warning"
    ? `Priorita v oblasti: ${top.label}.`
    : `Ve vybrané oblasti je ${featureCount} dostupných objektů; nejbližší kontext: ${top.label}.`;
}

function areaSummaryConfidence(
  featureCount: number,
  staleFeatureCount: number,
  uncertaintyCount: number,
  providers: AreaSummaryProviderSlice[]
): "high" | "low" | "medium" {
  if (providers.length === 0 || uncertaintyCount >= 5) {
    return "low";
  }
  if (featureCount > 0 && staleFeatureCount === 0 && uncertaintyCount === 0) {
    return "high";
  }
  return "medium";
}

function areaSummarySourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.flatMap((source) => {
    if (!isRecord(source)) {
      return [];
    }
    const sourceId = optionalTrimmedString(source.sourceId, 160);
    return sourceId ? [sourceId] : [];
  }))).sort();
}

function areaSummaryStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = optionalTrimmedString(item, 280);
        return text ? [text] : [];
      })
    : [];
}

function areaSummarySummaryNumber(collection: Record<string, unknown>, key: string, fallback: number): number {
  const summary = isRecord(collection.summary) ? collection.summary : {};
  const value = Number(summary[key]);
  return Number.isFinite(value) ? value : fallback;
}

interface CopAreaFusionPayloadInput {
  areaSummary: Record<string, unknown>;
  generatedAt: string;
  invocationId: string;
  priorityLimit: number;
}

interface AreaFusionEvidence {
  category?: string;
  confidence?: number;
  detail?: string;
  evidenceId: string;
  featureId?: string;
  label: string;
  layer?: string;
  location?: AreaSummaryLocation;
  observedAt?: string;
  providerId: string;
  severity: AreaSummarySeverity;
  sourceId?: string;
  stale: boolean;
  validUntil?: string;
}

interface AreaFusionPriority {
  category?: string;
  confidence: number;
  evidence: AreaFusionEvidence[];
  explanation: string;
  location?: AreaSummaryLocation;
  metrics: {
    evidenceCount: number;
    locatedEvidenceCount: number;
    providerCount: number;
    staleEvidenceCount: number;
  };
  priorityId: string;
  recommendedAction: string;
  severity: AreaSummarySeverity;
  sourceRefs: Array<Record<string, unknown>>;
  title: string;
}

function buildCopAreaFusionPayload(input: CopAreaFusionPayloadInput): Record<string, unknown> {
  const evidence = areaFusionEvidenceFromSummary(input.areaSummary).sort(compareAreaFusionEvidence);
  const actionableEvidence = evidence.filter((item) => item.severity !== "info");
  const fusionEvidence = actionableEvidence.length > 0 ? actionableEvidence : evidence;
  const priorities = buildAreaFusionPriorities(fusionEvidence, input.priorityLimit);
  const summary = isRecord(input.areaSummary.summary) ? input.areaSummary.summary : {};
  const summaryFeatureCount = Number(summary.featureCount);
  const uncertainties = areaFusionUncertainties(input.areaSummary, fusionEvidence);
  const providerIds = Array.from(new Set(evidence.map((item) => item.providerId))).sort();
  const criticalPriorityCount = priorities.filter((priority) => priority.severity === "critical").length;
  const warningPriorityCount = priorities.filter((priority) => priority.severity === "warning").length;
  return {
    audit: {
      eventType: "ai.tool.invoked",
      invocationId: input.invocationId
    },
    confidence: areaFusionOverallConfidence(priorities, uncertainties),
    contractVersion: "cop-area-fusion-v1",
    generatedAt: input.generatedAt,
    headline: areaFusionHeadline(priorities, Number.isFinite(summaryFeatureCount) ? summaryFeatureCount : evidence.length),
    priorities,
    scope: isRecord(input.areaSummary.scope) ? input.areaSummary.scope : {},
    sourceSummary: {
      evidenceCount: evidence.length,
      providerCount: providerIds.length,
      providers: providerIds,
      sources: Array.isArray(input.areaSummary.sources) ? input.areaSummary.sources.slice(0, 12) : []
    },
    summary: {
      criticalPriorityCount,
      evidenceCount: evidence.length,
      priorityCount: priorities.length,
      providerCount: providerIds.length,
      uncertaintyCount: uncertainties.length,
      warningPriorityCount
    },
    uncertainties
  };
}

function areaFusionEvidenceFromSummary(areaSummary: Record<string, unknown>): AreaFusionEvidence[] {
  if (!Array.isArray(areaSummary.notableFeatures)) {
    return [];
  }
  return areaSummary.notableFeatures.flatMap((candidate, index) => areaFusionEvidenceFromCandidate(candidate, index));
}

function areaFusionEvidenceFromCandidate(candidate: unknown, index: number): AreaFusionEvidence[] {
  if (!isRecord(candidate)) {
    return [];
  }
  const label = optionalTrimmedString(candidate.label, 180);
  const providerId = optionalTrimmedString(candidate.providerId, 80);
  if (!label || !providerId) {
    return [];
  }
  const featureId = optionalTrimmedString(candidate.featureId, 160);
  const layer = optionalTrimmedString(candidate.layer, 120);
  const sourceId = optionalTrimmedString(candidate.sourceId, 120);
  const location = areaFusionLocationFromCandidate(candidate);
  return [{
    ...(optionalTrimmedString(candidate.category, 120) ? { category: optionalTrimmedString(candidate.category, 120) } : {}),
    ...(optionalFiniteNumber(candidate.confidence, 0, 1) !== undefined ? { confidence: optionalFiniteNumber(candidate.confidence, 0, 1) } : {}),
    ...(optionalTrimmedString(candidate.detail, 240) ? { detail: optionalTrimmedString(candidate.detail, 240) } : {}),
    evidenceId: featureId ?? areaFusionStableId("evidence", { index, label, layer, providerId }),
    ...(featureId ? { featureId } : {}),
    label,
    ...(layer ? { layer } : {}),
    ...(location ? { location } : {}),
    ...(optionalTrimmedString(candidate.observedAt, 80) ? { observedAt: optionalTrimmedString(candidate.observedAt, 80) } : {}),
    providerId,
    severity: normalizeAreaSummarySeverity(candidate.severity),
    ...(sourceId ? { sourceId } : {}),
    stale: candidate.stale === true,
    ...(optionalTrimmedString(candidate.validUntil, 80) ? { validUntil: optionalTrimmedString(candidate.validUntil, 80) } : {})
  }];
}

function areaFusionLocationFromCandidate(candidate: Record<string, unknown>): AreaSummaryLocation | undefined {
  const location = isRecord(candidate.location) ? candidate.location : undefined;
  const lat = optionalFiniteNumber(location?.lat, -90, 90);
  const lon = optionalFiniteNumber(location?.lon, -180, 180);
  return lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
}

function buildAreaFusionPriorities(evidence: AreaFusionEvidence[], limit: number): AreaFusionPriority[] {
  const groups: AreaFusionEvidence[][] = [];
  for (const item of evidence) {
    const compatibleGroup = groups.find((group) => areaFusionCanJoinGroup(group, item));
    if (compatibleGroup) {
      compatibleGroup.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups
    .map(buildAreaFusionPriority)
    .sort(compareAreaFusionPriorities)
    .slice(0, limit);
}

function areaFusionCanJoinGroup(group: AreaFusionEvidence[], item: AreaFusionEvidence): boolean {
  const lead = group[0];
  if (!lead) {
    return false;
  }
  const categoryMatch = areaFusionCategoryKey(lead) === areaFusionCategoryKey(item);
  const severityClose = Math.abs(areaSummarySeverityRank(lead.severity) - areaSummarySeverityRank(item.severity)) <= 1;
  if (lead.location && item.location) {
    return areaFusionHaversineMeters(lead.location.lat, lead.location.lon, item.location.lat, item.location.lon) <= 3_000 && (categoryMatch || severityClose);
  }
  return categoryMatch && severityClose;
}

function buildAreaFusionPriority(group: AreaFusionEvidence[]): AreaFusionPriority {
  const sortedEvidence = [...group].sort(compareAreaFusionEvidence);
  const top = sortedEvidence[0] ?? group[0];
  const severity = sortedEvidence.reduce<AreaSummarySeverity>(
    (highest, item) => areaSummarySeverityRank(item.severity) > areaSummarySeverityRank(highest) ? item.severity : highest,
    "info"
  );
  const providerCount = new Set(sortedEvidence.map((item) => item.providerId)).size;
  const staleEvidenceCount = sortedEvidence.filter((item) => item.stale).length;
  const locatedEvidenceCount = sortedEvidence.filter((item) => item.location).length;
  const category = top?.category ?? top?.layer;
  const location = areaFusionCentroid(sortedEvidence);
  return {
    ...(category ? { category } : {}),
    confidence: areaFusionPriorityConfidence(sortedEvidence, severity),
    evidence: sortedEvidence,
    explanation: areaFusionExplanation(sortedEvidence, severity),
    ...(location ? { location } : {}),
    metrics: {
      evidenceCount: sortedEvidence.length,
      locatedEvidenceCount,
      providerCount,
      staleEvidenceCount
    },
    priorityId: areaFusionStableId("fusion", sortedEvidence.map((item) => item.evidenceId)),
    recommendedAction: areaFusionRecommendedAction(severity),
    severity,
    sourceRefs: sortedEvidence.map(areaFusionSourceRef),
    title: areaFusionPriorityTitle(severity, sortedEvidence)
  };
}

function compareAreaFusionEvidence(a: AreaFusionEvidence, b: AreaFusionEvidence): number {
  const severityDelta = areaSummarySeverityRank(b.severity) - areaSummarySeverityRank(a.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  if (a.stale !== b.stale) {
    return a.stale ? 1 : -1;
  }
  const confidenceDelta = (b.confidence ?? 0) - (a.confidence ?? 0);
  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }
  return areaFusionTimeRank(b.observedAt) - areaFusionTimeRank(a.observedAt);
}

function compareAreaFusionPriorities(a: AreaFusionPriority, b: AreaFusionPriority): number {
  const severityDelta = areaSummarySeverityRank(b.severity) - areaSummarySeverityRank(a.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  const confidenceDelta = b.confidence - a.confidence;
  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }
  return b.metrics.evidenceCount - a.metrics.evidenceCount;
}

function areaFusionPriorityConfidence(evidence: AreaFusionEvidence[], severity: AreaSummarySeverity): number {
  const providerCount = new Set(evidence.map((item) => item.providerId)).size;
  const averageEvidenceConfidence = evidence
    .map((item) => item.confidence)
    .filter((value): value is number => typeof value === "number")
    .reduce((sum, value, _index, values) => sum + value / Math.max(1, values.length), 0);
  const stalePenalty = evidence.some((item) => item.stale) ? 0.12 : 0;
  const locationPenalty = evidence.some((item) => !item.location) ? 0.04 : 0;
  const value =
    0.34 +
    Math.min(0.24, evidence.length * 0.08) +
    Math.min(0.16, providerCount * 0.05) +
    areaSummarySeverityRank(severity) * 0.04 +
    Math.min(0.12, averageEvidenceConfidence * 0.12) -
    stalePenalty -
    locationPenalty;
  return Math.round(Math.max(0.2, Math.min(0.95, value)) * 100) / 100;
}

function areaFusionCentroid(evidence: AreaFusionEvidence[]): AreaSummaryLocation | undefined {
  const locations = evidence.flatMap((item) => item.location ? [item.location] : []);
  if (locations.length === 0) {
    return undefined;
  }
  const sum = locations.reduce(
    (accumulator, location) => ({
      lat: accumulator.lat + location.lat,
      lon: accumulator.lon + location.lon
    }),
    { lat: 0, lon: 0 }
  );
  return {
    lat: Math.round((sum.lat / locations.length) * 1_000_000) / 1_000_000,
    lon: Math.round((sum.lon / locations.length) * 1_000_000) / 1_000_000
  };
}

function areaFusionCategoryKey(evidence: AreaFusionEvidence): string {
  return (evidence.category ?? evidence.layer ?? evidence.providerId).toLowerCase();
}

function areaFusionPriorityTitle(severity: AreaSummarySeverity, evidence: AreaFusionEvidence[]): string {
  const top = evidence[0];
  const prefix: Record<AreaSummarySeverity, string> = {
    advisory: "Sledovat",
    critical: "Kritická priorita",
    info: "Kontext",
    warning: "Výstraha"
  };
  if (!top) {
    return `${prefix[severity]} v oblasti`;
  }
  return evidence.length > 1
    ? `${prefix[severity]}: ${top.label} + ${evidence.length - 1} související podklad`
    : `${prefix[severity]}: ${top.label}`;
}

function areaFusionExplanation(evidence: AreaFusionEvidence[], severity: AreaSummarySeverity): string {
  const providerCount = new Set(evidence.map((item) => item.providerId)).size;
  const locatedEvidenceCount = evidence.filter((item) => item.location).length;
  return [
    "Deterministická fúze vybrala prioritu podle závažnosti, aktuálnosti, kategorie a dostupné polohy.",
    `Závažnost: ${severity}.`,
    `Evidence: ${evidence.length} podkladů z ${providerCount} providerů; ${locatedEvidenceCount} podkladů má použitelnou polohu.`,
    "Výsledek je návrh pro ověření operátorem, nikoli automaticky založený incident."
  ].join(" ");
}

function areaFusionRecommendedAction(severity: AreaSummarySeverity): string {
  if (severity === "critical") {
    return "Okamžitě ověřit situaci proti primárnímu zdroji, informovat odpovědnou roli a připravit nebo aktualizovat incident.";
  }
  if (severity === "warning") {
    return "Prověřit detail zdroje, zkontrolovat související hlášení a podle dopadu eskalovat na incident.";
  }
  if (severity === "advisory") {
    return "Sledovat vývoj, doplnit chybějící kontext a upozornit uživatele pouze při zhoršení.";
  }
  return "Použít jako situační kontext bez samostatné eskalace.";
}

function areaFusionSourceRef(evidence: AreaFusionEvidence): Record<string, unknown> {
  return {
    id: evidence.featureId ?? evidence.evidenceId,
    kind: evidence.providerId === "community" ? "community_report" : "provider_feature",
    ...(evidence.observedAt ? { observedAt: evidence.observedAt } : {}),
    sourceId: evidence.sourceId ?? evidence.providerId,
    title: evidence.label
  };
}

function areaFusionUncertainties(areaSummary: Record<string, unknown>, evidence: AreaFusionEvidence[]): string[] {
  const base = areaSummaryStringArray(areaSummary.uncertainties);
  const locatedEvidenceCount = evidence.filter((item) => item.location).length;
  const geometryWarning = evidence.length > 0 && locatedEvidenceCount === 0
    ? ["Fúze nemá k dispozici přesnou polohu vybraných podkladů; prostorová korelace je omezená."]
    : [];
  const staleWarning = evidence.some((item) => item.stale)
    ? ["Některé podklady jsou označené jako zastaralé."]
    : [];
  return Array.from(new Set([...base, ...geometryWarning, ...staleWarning])).slice(0, 20);
}

function areaFusionOverallConfidence(priorities: AreaFusionPriority[], uncertainties: string[]): "high" | "low" | "medium" {
  if (priorities.length === 0 || uncertainties.length >= 5) {
    return "low";
  }
  if (priorities.some((priority) => priority.confidence >= 0.75) && uncertainties.length === 0) {
    return "high";
  }
  return "medium";
}

function areaFusionHeadline(priorities: AreaFusionPriority[], featureCount: number): string {
  const top = priorities[0];
  if (!top) {
    return featureCount > 0
      ? `Ve vybrané oblasti je ${featureCount} objektů, ale žádná silná fúzní priorita.`
      : "Ve vybrané oblasti nejsou z dostupných podkladů odvozené fúzní priority.";
  }
  return priorities.length > 1
    ? `${top.title}; dalších priorit: ${priorities.length - 1}.`
    : top.title;
}

function areaFusionStableId(prefix: string, payload: unknown): string {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 20)}`;
}

function areaFusionTimeRank(value: string | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function areaFusionHaversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6_371_000;
  const phi1 = areaFusionToRadians(lat1);
  const phi2 = areaFusionToRadians(lat2);
  const deltaPhi = areaFusionToRadians(lat2 - lat1);
  const deltaLambda = areaFusionToRadians(lon2 - lon1);
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function areaFusionToRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function compareSourceHealthItems(a: SourceHealthItem, b: SourceHealthItem): number {
  const healthDelta = sourceHealthRank(b.health) - sourceHealthRank(a.health);
  if (healthDelta !== 0) {
    return healthDelta;
  }
  return a.displayName.localeCompare(b.displayName, "cs");
}

function sourceHealthRank(health: SourceHealthItem["health"]): number {
  const ranks: Record<SourceHealthItem["health"], number> = {
    DEGRADED: 6,
    UNAVAILABLE: 5,
    STALE: 4,
    WAITING: 3,
    QUIET: 2,
    DISABLED: 1,
    ONLINE: 0
  };
  return ranks[health] ?? 0;
}

function buildSourceHealthSummary(items: SourceHealthItem[]): Record<string, unknown> {
  const healthCounts = items.reduce<Record<string, number>>((counts, item) => ({
    ...counts,
    [item.health]: (counts[item.health] ?? 0) + 1
  }), {});
  return {
    count: items.length,
    currentTrackCount: items.reduce((sum, item) => sum + item.currentTracks, 0),
    degradedCount: (healthCounts.DEGRADED ?? 0) + (healthCounts.UNAVAILABLE ?? 0) + (healthCounts.STALE ?? 0),
    healthCounts,
    totalTrackCount: items.reduce((sum, item) => sum + item.totalTracks, 0),
    warningCount: items.reduce((sum, item) => sum + (item.warnings?.length ?? 0), 0)
  };
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

function parseSafetyHydroStationDetailQuery(value: Record<string, unknown>): SafetyHydroStationDetailQuery | null {
  const from = optionalIsoString(value.from);
  const to = optionalIsoString(value.to);
  const series = optionalTrimmedString(value.series, 80);
  if ((value.from !== undefined && !from) || (value.to !== undefined && !to)) {
    return null;
  }
  if (series && !series.split(",").every((item) => isHydroSeriesId(item.trim()))) {
    return null;
  }
  return {
    ...(from ? { from } : {}),
    ...(series ? { series } : {}),
    ...(to ? { to } : {})
  };
}

function optionalIsoString(value: unknown): string | undefined {
  const raw = optionalTrimmedString(value, 80);
  if (!raw) {
    return undefined;
  }
  return Number.isFinite(Date.parse(raw)) ? raw : undefined;
}

function isHydroSeriesId(value: string): boolean {
  return value === "H" || value === "Q" || value === "TH" || value === "H_F" || value === "Q_F";
}

function normalizeSafetyNotificationEvaluationRequest(value: Record<string, unknown>): {
  audience?: CopNotificationAudience;
  currentLocation?: { lat: number; lon: number; radiusKm?: number };
  dryRun: boolean;
  safetyQuery: SafetyFeatureQuery;
} | null {
  const bbox = parseMapQueryBbox(value.bbox);
  if (!bbox) {
    return null;
  }
  const requestedLayers = normalizeMapQueryStringList(value.layers ?? value.layerIds)
    .filter(isSafetyLayerId)
    .filter((layerId) => layerId !== "boundary_admin");
  const layers = requestedLayers.length > 0
    ? requestedLayers
    : ["weather_alerts", "warnings", "fire", "flood"] satisfies SafetyLayerId[];
  const audience = normalizeNotificationAudience(value.audience);
  const currentLocation = normalizeNotificationLocation(value.currentLocation);
  return {
    ...(audience ? { audience } : {}),
    ...(currentLocation ? { currentLocation } : {}),
    dryRun: value.dryRun !== false,
    safetyQuery: {
      bbox,
      layers,
      limit: optionalFiniteNumber(value.limit, 1, 500) ?? 100
    }
  };
}

function normalizeNotificationAudience(value: unknown): CopNotificationAudience | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const audience: CopNotificationAudience = {
    areaIds: normalizeAudienceIds(value.areaIds),
    groupIds: normalizeAudienceIds(value.groupIds),
    userIds: normalizeAudienceIds(value.userIds)
  };
  const compactAudience: CopNotificationAudience = {
    ...(audience.areaIds?.length ? { areaIds: audience.areaIds } : {}),
    ...(audience.groupIds?.length ? { groupIds: audience.groupIds } : {}),
    ...(audience.userIds?.length ? { userIds: audience.userIds } : {})
  };
  return Object.keys(compactAudience).length > 0 ? compactAudience : undefined;
}

function normalizeAudienceIds(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = Array.from(new Set(values.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 160)] : []))).slice(0, 100);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNotificationLocation(value: unknown): { lat: number; lon: number; radiusKm?: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const lat = optionalFiniteNumber(value.lat, -90, 90);
  const lon = optionalFiniteNumber(value.lon, -180, 180);
  const radiusKm = optionalFiniteNumber(value.radiusKm, 0.2, 100);
  return lat !== undefined && lon !== undefined
    ? {
        lat,
        lon,
        ...(radiusKm !== undefined ? { radiusKm } : {})
      }
    : undefined;
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
  const safetySources = new Set<SafetyDataSourceId>();
  const flightLayers = new Set<FlightReferenceLayerId>();
  const missionArenaLayers = new Set<MissionArenaLayerId>();
  const takLayers = new Set<TakGatewayLayerId>();
  const communityLayerIds = new Set<string>();
  let situationTechnology: string | undefined;

  for (const layer of layers) {
    const supportedFeatureQuery = layer.query.mode === "bbox"
      || (layer.query.mode === "grid" && layer.query.providerId === "sim.situation-data");
    if (!supportedFeatureQuery) {
      continue;
    }
    if (layer.query.providerId === "sim.situation-data") {
      for (const layerId of layer.query.providerLayerIds ?? []) {
        const situationLayerId = situationLayerIdFromProviderLayerId(layerId);
        if (situationLayerId) {
          situationLayers.add(situationLayerId);
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
      for (const sourceId of layer.query.providerSourceIds ?? []) {
        if (isSafetyDataSourceId(sourceId)) {
          safetySources.add(sourceId);
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
            limit: request.limit,
            ...(safetySources.size > 0 ? { sources: Array.from(safetySources) } : {})
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
    || value === "air_quality_grid"
    || value === "boundary_admin"
    || value === "boundary_country"
    || value === "boundary_district"
    || value === "boundary_municipality"
    || value === "boundary_orp"
    || value === "boundary_region"
    || value === "fire"
    || value === "flood"
    || value === "ground"
    || value === "mobile"
    || value === "mobile_coverage"
    || value === "mobile_network"
    || value === "place_settlements"
    || value === "traffic"
    || value === "warnings"
    || value === "weather_alerts"
    || value === "weather_webcams"
    || value === "weather"
    || value === "weather_humidity_grid"
    || value === "weather_precipitation_grid"
    || value === "weather_pressure_grid"
    || value === "weather_radar_nowcast"
    || value === "weather_radar_precipitation"
    || value === "weather_radar_reflectivity"
    || value === "weather_temperature_grid"
    || value === "weather_thunderstorm_risk"
    || value === "weather_wind_field";
}

function situationLayerIdFromProviderLayerId(value: string): SituationLayerId | undefined {
  if (isSituationLayerId(value)) {
    return value;
  }
  switch (value) {
    case "air_quality.grid":
    case "air_quality_grid":
    case "public.safety.air_quality_grid":
      return "air_quality_grid";
    case "weather.humidity":
    case "weather.humidity_grid":
    case "public.weather.humidity_grid":
      return "weather_humidity_grid";
    case "weather.precipitation":
    case "weather.precipitation_grid":
    case "public.weather.precipitation_grid":
      return "weather_precipitation_grid";
    case "weather.pressure":
    case "weather.pressure_grid":
    case "public.weather.pressure_grid":
      return "weather_pressure_grid";
    case "weather.webcams":
    case "weather_webcams":
    case "public.weather.webcams":
      return "weather_webcams";
    case "weather.radar_nowcast":
    case "weather_radar_nowcast":
    case "public.weather.radar_nowcast":
      return "weather_radar_nowcast";
    case "weather.radar_precipitation":
    case "weather_radar_precipitation":
    case "public.weather.radar_precipitation":
      return "weather_radar_precipitation";
    case "weather.radar_reflectivity":
    case "weather_radar_reflectivity":
    case "public.weather.radar_reflectivity":
      return "weather_radar_reflectivity";
    case "weather.temperature":
    case "weather.temperature_grid":
    case "public.weather.temperature_grid":
      return "weather_temperature_grid";
    case "weather.thunderstorm_risk":
    case "weather_thunderstorm_risk":
    case "public.safety.thunderstorm_risk":
      return "weather_thunderstorm_risk";
    case "weather.wind":
    case "weather.wind_field":
    case "public.weather.wind_field":
      return "weather_wind_field";
    default:
      return undefined;
  }
}

function isSafetyLayerId(value: string): value is SafetyLayerId {
  return value === "boundary_admin" || value === "fire" || value === "flood" || value === "warnings" || value === "weather_alerts";
}

function isSafetyDataSourceId(value: string): value is SafetyDataSourceId {
  return value === "admin_boundaries"
    || value === "chmi_alerts"
    || value === "chmi_hydro"
    || value === "fire_hotspots"
    || value === "fire_incidents"
    || value === "mock"
    || value === "nasa_firms"
    || value === "weather_alerts";
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
  const situationLayers = selectedLayers.filter((layer) =>
    (layer.query.mode === "bbox" || layer.query.mode === "grid")
    && layer.query.providerId === "sim.situation-data"
  );
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
  if (providerLayerIds.length > 0) {
    const normalizedProviderLayerIds = providerLayerIds
      .map(situationLayerIdFromProviderLayerId)
      .filter((value): value is SituationLayerId => Boolean(value));
    const rawLayerMatch = providerLayerIds.includes(feature.properties.layer)
      || providerLayerIds.includes(feature.properties.layerId ?? "")
      || providerLayerIds.includes(feature.properties.providerLayerId ?? "");
    const normalizedLayerMatch = normalizedProviderLayerIds.includes(feature.properties.layer);
    if (!rawLayerMatch && !normalizedLayerMatch) {
      return false;
    }
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

function actorToIncidentActor(actor: AuthenticatedActor): IncidentActor {
  return {
    displayName: actor.displayName,
    subjectId: actor.subjectId,
    username: actor.username
  };
}

function actorCommunitySubjectAliases(actor: AuthenticatedActor): string[] {
  return Array.from(new Set([
    actor.subjectId,
    actor.username,
    actor.email
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function actorToSketchActor(actor: AuthenticatedActor) {
  return {
    displayName: actor.displayName,
    subjectId: actor.subjectId,
    username: actor.username
  };
}

function isFloodDemoGroup(group: CommunityGroupRecord): boolean {
  return isFloodDemoMetadata(group.metadata);
}

function isFloodDemoReport(report: CommunityReportRecord): boolean {
  return isFloodDemoMetadata(report.properties);
}

function isFloodDemoDrawing(drawing: SketchDrawingFeature): boolean {
  return isFloodDemoMetadata(drawing.properties.properties);
}

function isFloodDemoMetadata(value: unknown): boolean {
  return isRecord(value) && value.demoScenarioId === floodDemoScenarioId;
}

function floodDemoBaseMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    demo: true,
    demoLabel: "DEMO DATA",
    demoScenarioId: floodDemoScenarioId,
    eventId: floodDemoEventId,
    ...extra
  };
}

function floodDemoGroupMetadata(actor: AuthenticatedActor): Record<string, unknown> {
  return floodDemoBaseMetadata({
    demoConversation: {
      media: [
        {
          byteSizeLabel: "2,4 MB",
          caption: "Rozliv u silnice",
          kind: "photo",
          title: "IMG_4821.jpg"
        },
        {
          byteSizeLabel: "18 MB",
          caption: "Průtok u mostu",
          kind: "video",
          title: "IMG_4822.mp4"
        },
        {
          byteSizeLabel: "1,2 MB",
          caption: "Koordinační podklady",
          kind: "document",
          title: "Situacni_zprava.pdf"
        },
        {
          caption: "50.1047, 14.4252",
          kind: "location",
          title: "Most Železný"
        }
      ],
      messages: [
        {
          authorName: "Jan Novák",
          body: "Aktualizace stavu hladiny na tocích v postižené oblasti. Žádáme potvrzení průjezdnosti mostu.",
          direction: "incoming",
          id: "demo-msg-1",
          role: "operační důstojník",
          sentAt: "2026-05-16T10:18:00Z"
        },
        {
          authorName: "Petr Svoboda",
          body: "Na řece Berounce bude 3. SPA dosažen v odpoledních hodinách. Doplňuji prioritu evakuační trasy.",
          direction: "incoming",
          id: "demo-msg-2",
          link: {
            label: "Událost: E2025-0516-0001"
          },
          role: "HZS Středočeský kraj",
          sentAt: "2026-05-16T10:21:00Z"
        },
        {
          authorName: actor.displayName,
          body: "Prosím o upřesnění předpokládaného času a místa. Zanesu to do situační mapy.",
          direction: "outgoing",
          id: "demo-msg-3",
          role: "COP",
          sentAt: "2026-05-16T10:24:00Z"
        }
      ],
      pinnedContext: "Důležité kontakty, odkazy a média k povodňové události.",
      summary: "Koordinace povodňové situace, hlášení z terénu a sdílená média.",
      title: "Krizový štáb - Povodeň"
    },
    event: {
      id: "E2025-0516-0001",
      kind: "flood",
      startedAt: "2026-05-16T08:30:00Z",
      status: "active",
      title: "Povodeň - Středočeský kraj"
    }
  });
}

function floodDemoReportSeeds(groupId: string, requestNow: Date) {
  const groupName = "DEMO Povodeň - Středočeský kraj";
  return [
    {
      category: "flood" as const,
      description: "Voda postupně zaplavuje podjezd. Příjezd je vhodný jen pro složky s vyšší průjezdností.",
      location: { accuracyM: 20, lat: 50.1585, lon: 14.3974, source: "manual" as const },
      observedAt: "2026-05-16T10:12:00Z",
      properties: floodDemoBaseMetadata({
        groupId,
        groupName,
        hazardSeverity: "warning",
        recommendedAction: "Zobrazit v mapě, ověřit průjezdnost a informovat místní skupinu.",
        validUntil: isoAfter(requestNow, 8)
      }),
      title: "Zaplavený podjezd u Roztok",
      visibility: "public" as const
    },
    {
      category: "bridge_damage" as const,
      description: "Most má poškozený kraj vozovky a je nutné jej označit jako rizikové místo.",
      location: { accuracyM: 18, lat: 49.9781, lon: 14.392, source: "manual" as const },
      observedAt: "2026-05-16T10:18:00Z",
      properties: floodDemoBaseMetadata({
        groupId,
        groupName,
        hazardSeverity: "critical",
        recommendedAction: "Omezit průjezd, připojit fotografii a předat do události.",
        validUntil: isoAfter(requestNow, 12)
      }),
      title: "Poškozený most Zbraslav",
      visibility: "public" as const
    },
    {
      category: "road_blockage" as const,
      description: "Nábřeží je neprůjezdné kvůli stojící vodě a naplaveninám.",
      location: { accuracyM: 15, lat: 50.0912, lon: 14.414, source: "manual" as const },
      observedAt: "2026-05-16T10:24:00Z",
      properties: floodDemoBaseMetadata({
        groupId,
        groupName,
        hazardSeverity: "warning",
        recommendedAction: "Použít navrženou objízdnou trasu v zákresu.",
        validUntil: isoAfter(requestNow, 6)
      }),
      title: "Uzavírka nábřeží",
      visibility: "public" as const
    }
  ];
}

function isFloodDemoReportSeedCurrent(report: CommunityReportRecord, seed: { properties: Record<string, unknown> }): boolean {
  return report.properties.demoScenarioId === seed.properties.demoScenarioId
    && report.properties.eventId === seed.properties.eventId
    && report.properties.groupId === seed.properties.groupId
    && report.properties.groupName === seed.properties.groupName
    && report.properties.hazardSeverity === seed.properties.hazardSeverity
    && report.properties.recommendedAction === seed.properties.recommendedAction;
}

function floodDemoDrawingSeeds(groupId: string): Array<Omit<CreateSketchDrawingInput, "actor">> {
  return [
    {
      eventId: floodDemoEventId,
      geometry: {
        coordinates: [[
          [14.245, 50.195],
          [14.49, 50.215],
          [14.56, 50.08],
          [14.36, 49.99],
          [14.18, 50.06],
          [14.245, 50.195]
        ]],
        type: "Polygon"
      },
      groupId,
      kind: "polygon",
      label: "Evakuacni oblast Praha sever",
      locked: false,
      properties: floodDemoBaseMetadata({
        groupId,
        purpose: "evacuation_area"
      }),
      style: {
        fill: "#2f80ed",
        lineWidth: 2,
        opacity: 0.24,
        stroke: "#2f80ed"
      },
      symbol: {
        iconId: "evacuation",
        palette: "civil"
      },
      visibility: "public"
    },
    {
      eventId: floodDemoEventId,
      geometry: {
        coordinates: [
          [14.39, 50.08],
          [14.31, 50.03],
          [14.24, 49.99],
          [14.18, 49.94]
        ],
        type: "LineString"
      },
      groupId,
      kind: "line",
      label: "Doporucena evakuacni trasa",
      locked: false,
      properties: floodDemoBaseMetadata({
        groupId,
        purpose: "route"
      }),
      style: {
        fill: "#22c55e",
        lineWidth: 4,
        opacity: 0.9,
        stroke: "#22c55e"
      },
      symbol: {
        iconId: "route",
        palette: "civil"
      },
      visibility: "public"
    },
    {
      eventId: floodDemoEventId,
      geometry: {
        coordinates: [14.345, 50.035],
        type: "Point"
      },
      groupId,
      kind: "marker",
      label: "Misto setkani",
      locked: false,
      properties: floodDemoBaseMetadata({
        groupId,
        purpose: "meeting_point"
      }),
      style: {
        fill: "#22c55e",
        lineWidth: 2,
        opacity: 0.95,
        stroke: "#ffffff"
      },
      symbol: {
        iconId: "meeting_point",
        palette: "civil"
      },
      visibility: "public"
    }
  ];
}

function isoAfter(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function userDirectoryEntry(profile: UserProfileRecord) {
  return {
    displayName: profile.displayName,
    ...(profile.email ? { email: profile.email } : {}),
    subjectId: profile.subjectId,
    username: profile.username
  };
}

async function resolveCommunityGroupMemberIdentity(member: {
  displayName: string;
  role: CommunityGroupMemberRole;
  status: CommunityGroupMemberStatus;
  subjectId: string;
  username: string;
}, directory: {
  readProfile: (subjectId: string) => Promise<UserProfileRecord | null>;
  searchProfiles: (query: string, limit?: number) => Promise<UserProfileRecord[]>;
}): Promise<
  | {
      member: {
        displayName: string;
        role: CommunityGroupMemberRole;
        status: CommunityGroupMemberStatus;
        subjectId: string;
        username: string;
      };
      resolution: "canonical" | "profile-subject" | "profile-username";
    }
  | { error: string }
> {
  const subjectProfile = await directory.readProfile(member.subjectId);
  if (subjectProfile) {
    return {
      member: {
        displayName: subjectProfile.displayName,
        role: member.role,
        status: member.status,
        subjectId: subjectProfile.subjectId,
        username: subjectProfile.username
      },
      resolution: "profile-subject"
    };
  }

  const handleProfile = await resolveProfileByHandle(member.subjectId, directory);
  if (handleProfile) {
    return {
      member: {
        displayName: handleProfile.displayName,
        role: member.role,
        status: member.status,
        subjectId: handleProfile.subjectId,
        username: handleProfile.username
      },
      resolution: "profile-username"
    };
  }

  if (looksLikeHumanLogin(member.subjectId)) {
    return {
      error: "Community group member must resolve to a known COP user profile. Sign in as that user once or use the user search endpoint before adding the member."
    };
  }

  return {
    member,
    resolution: "canonical"
  };
}

async function resolveProfileByHandle(handle: string, directory: {
  searchProfiles: (query: string, limit?: number) => Promise<UserProfileRecord[]>;
}): Promise<UserProfileRecord | null> {
  const normalized = handle.trim().toLowerCase();
  const matches = (await directory.searchProfiles(handle, 10)).filter((profile) =>
    profile.username.toLowerCase() === normalized ||
    profile.email?.toLowerCase() === normalized ||
    profile.displayName.toLowerCase() === normalized
  );
  return matches.length === 1 ? matches[0] ?? null : null;
}

function looksLikeHumanLogin(value: string): boolean {
  return value.includes("@") || /^[a-z][a-z0-9_-]*\.[a-z0-9_.-]+$/iu.test(value);
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

function normalizeCommunityGroupMetadataRequest(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    return null;
  }
  return normalizedJsonRecord(value.metadata, 4000);
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

function normalizeSketchDrawingQuery(value: unknown, actor: AuthenticatedActor | null, actorGroupIds: Set<string>): SketchDrawingQuery | null {
  if (!isRecord(value)) {
    return {
      allowedGroupIds: Array.from(actorGroupIds),
      limit: 250,
      ...(actor ? { subjectId: actor.subjectId } : {})
    };
  }
  const bbox = parseBboxQuery(value.bbox);
  const groupId = optionalUuid(value.groupId);
  const eventId = optionalTrimmedString(value.eventId, 160);
  return {
    allowedGroupIds: Array.from(actorGroupIds),
    ...(bbox ? { bbox } : {}),
    ...(eventId ? { eventId } : {}),
    ...(groupId ? { groupId } : {}),
    limit: optionalFiniteNumber(value.limit, 1, 1000) ?? 250,
    ...(actor ? { subjectId: actor.subjectId } : {})
  };
}

function normalizeCreateSketchDrawingRequest(value: unknown, actor: AuthenticatedActor): CreateSketchDrawingInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const geometry = normalizeSketchGeometry(value.geometry);
  const kind = normalizeSketchDrawingKind(value.kind);
  const visibility = normalizeSketchDrawingVisibility(value.visibility) ?? "private";
  if (!geometry || !kind) {
    return null;
  }
  const groupId = optionalUuid(value.groupId);
  const eventId = optionalTrimmedString(value.eventId, 160);
  return {
    actor: actorToSketchActor(actor),
    ...(eventId ? { eventId } : {}),
    geometry,
    ...(groupId ? { groupId } : {}),
    kind,
    ...(optionalTrimmedString(value.label, 160) ? { label: optionalTrimmedString(value.label, 160) } : {}),
    ...(typeof value.locked === "boolean" ? { locked: value.locked } : {}),
    properties: normalizedJsonRecord(value.properties, 8000),
    style: normalizeSketchStyle(value.style),
    symbol: normalizeSketchSymbol(value.symbol),
    visibility
  };
}

function normalizeUpdateSketchDrawingRequest(value: unknown): UpdateSketchDrawingInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const geometry = hasOwn(value, "geometry") ? normalizeSketchGeometry(value.geometry) : undefined;
  const kind = hasOwn(value, "kind") ? normalizeSketchDrawingKind(value.kind) : undefined;
  const visibility = hasOwn(value, "visibility") ? normalizeSketchDrawingVisibility(value.visibility) : undefined;
  const groupId = hasOwn(value, "groupId") ? optionalUuid(value.groupId) ?? null : undefined;
  const eventId = hasOwn(value, "eventId") ? optionalTrimmedString(value.eventId, 160) ?? null : undefined;
  const update: UpdateSketchDrawingInput = {
    ...(eventId !== undefined ? { eventId } : {}),
    ...(geometry ? { geometry } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
    ...(kind ? { kind } : {}),
    ...(optionalTrimmedString(value.label, 160) ? { label: optionalTrimmedString(value.label, 160) } : {}),
    ...(typeof value.locked === "boolean" ? { locked: value.locked } : {}),
    ...(isRecord(value.properties) ? { properties: normalizedJsonRecord(value.properties, 8000) } : {}),
    ...(isRecord(value.style) ? { style: normalizeSketchStyle(value.style) } : {}),
    ...(isRecord(value.symbol) ? { symbol: normalizeSketchSymbol(value.symbol) } : {}),
    ...(visibility ? { visibility } : {})
  };
  return Object.keys(update).length > 0 ? update : null;
}

function normalizeSketchDrawingKind(value: unknown): SketchDrawingKind | undefined {
  return value === "arrow"
    || value === "circle"
    || value === "line"
    || value === "marker"
    || value === "measurement"
    || value === "point"
    || value === "polygon"
    || value === "text"
    ? value
    : undefined;
}

function normalizeSketchDrawingVisibility(value: unknown): SketchDrawingVisibility | undefined {
  return value === "event" || value === "group" || value === "private" || value === "public" ? value : undefined;
}

function normalizeSketchGeometry(value: unknown): SketchGeometry | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }
  if (value.type === "Point") {
    const coordinate = normalizeCoordinate(value.coordinates);
    return coordinate ? { coordinates: coordinate, type: "Point" } : undefined;
  }
  if (value.type === "LineString") {
    const coordinates = normalizeCoordinateList(value.coordinates, 2, 500);
    return coordinates ? { coordinates, type: "LineString" } : undefined;
  }
  if (value.type === "Polygon") {
    if (!Array.isArray(value.coordinates)) {
      return undefined;
    }
    const rings = value.coordinates.flatMap((ring) => {
      const coordinates = normalizeCoordinateList(ring, 4, 500);
      if (!coordinates) {
        return [];
      }
      const first = coordinates[0];
      const last = coordinates.at(-1);
      const closed = first && last && first[0] === last[0] && first[1] === last[1]
        ? coordinates
        : first
          ? [...coordinates, first]
          : coordinates;
      return closed.length >= 4 ? [closed] : [];
    });
    return rings.length > 0 ? { coordinates: rings, type: "Polygon" } : undefined;
  }
  return undefined;
}

function normalizeCoordinateList(value: unknown, minLength: number, maxLength: number): Array<[number, number]> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const coordinates = value.flatMap((item) => {
    const coordinate = normalizeCoordinate(item);
    return coordinate ? [coordinate] : [];
  }).slice(0, maxLength);
  return coordinates.length >= minLength ? coordinates : undefined;
}

function normalizeCoordinate(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) {
    return undefined;
  }
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lon) && Number.isFinite(lat)
    ? [clampNumber(lon, -180, 180), clampNumber(lat, -90, 90)]
    : undefined;
}

function normalizeSketchStyle(value: unknown): Partial<CreateSketchDrawingInput["style"]> {
  if (!isRecord(value)) {
    return {};
  }
  return {
    ...(normalizeCssColor(value.fill) ? { fill: normalizeCssColor(value.fill) } : {}),
    ...(optionalFiniteNumber(value.lineWidth, 1, 12) !== undefined ? { lineWidth: optionalFiniteNumber(value.lineWidth, 1, 12) } : {}),
    ...(optionalFiniteNumber(value.opacity, 0.05, 1) !== undefined ? { opacity: optionalFiniteNumber(value.opacity, 0.05, 1) } : {}),
    ...(normalizeCssColor(value.stroke) ? { stroke: normalizeCssColor(value.stroke) } : {})
  };
}

function normalizeSketchSymbol(value: unknown): Partial<CreateSketchDrawingInput["symbol"]> {
  if (!isRecord(value)) {
    return {};
  }
  return {
    ...(optionalTrimmedString(value.iconId, 80) ? { iconId: optionalTrimmedString(value.iconId, 80) } : {}),
    ...(value.palette === "civil" || value.palette === "professional" ? { palette: value.palette } : {}),
    ...(optionalTrimmedString(value.sidc, 32) ? { sidc: optionalTrimmedString(value.sidc, 32) } : {})
  };
}

function normalizeCssColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu.test(normalized) ? normalized : undefined;
}

function canReadSketchDrawingResponse(drawing: SketchDrawingFeature, actor: AuthenticatedActor | null, actorGroupIds: Set<string>): boolean {
  if (drawing.properties.visibility === "public") {
    return true;
  }
  if (!actor) {
    return false;
  }
  if (drawing.properties.ownerSubjectId === actor.subjectId) {
    return true;
  }
  if (drawing.properties.visibility === "group" && drawing.properties.groupId) {
    return actorGroupIds.has(drawing.properties.groupId);
  }
  return false;
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

function normalizeWebPushDeviceId(value: unknown): string | undefined {
  const deviceId = optionalTrimmedString(value, 96);
  return deviceId && /^[A-Za-z0-9._=-]{1,96}$/u.test(deviceId) ? deviceId : undefined;
}

function normalizeWebPushDeviceRegistrationRequest(value: unknown): MessagingWebPushDeviceRegistrationRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const subscription = isRecord(value.subscription) ? value.subscription : value;
  const keys = isRecord(subscription.keys) ? subscription.keys : {};
  const deviceId = normalizeWebPushDeviceId(value.deviceId ?? subscription.deviceId);
  const endpoint = normalizeWebPushEndpoint(subscription.endpoint);
  const auth = optionalTrimmedString(keys.auth, 512);
  const p256dh = optionalTrimmedString(keys.p256dh, 512);
  if (!deviceId || !endpoint || !auth || !p256dh) {
    return null;
  }
  const capabilities = normalizeWebPushCapabilities(value.capabilities);
  const notificationPreferences = normalizeWebPushPreferences(value.notificationPreferences);
  return {
    ...(capabilities ? { capabilities } : {}),
    deviceId,
    endpoint,
    keys: { auth, p256dh },
    ...(optionalTrimmedString(value.locale, 40) ? { locale: optionalTrimmedString(value.locale, 40) } : {}),
    ...(notificationPreferences ? { notificationPreferences } : {}),
    ...(optionalTrimmedString(value.timezone, 80) ? { timezone: optionalTrimmedString(value.timezone, 80) } : {})
  };
}

function normalizeWebPushEndpoint(value: unknown): string | undefined {
  const endpoint = optionalTrimmedString(value, 4096);
  if (!endpoint) {
    return undefined;
  }
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" ? endpoint : undefined;
  } catch {
    return undefined;
  }
}

function normalizeWebPushCapabilities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const capabilities = Array.from(new Set(value
    .map((item) => optionalTrimmedString(item, 64))
    .filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9_.:-]{1,64}$/u.test(item))))
    .slice(0, 20);
  return capabilities.length ? capabilities : undefined;
}

function normalizeWebPushPreferences(value: unknown): Record<string, boolean> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const preferences: Record<string, boolean> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (/^[A-Za-z0-9_.:-]{1,80}$/u.test(key) && typeof rawValue === "boolean") {
      preferences[key] = rawValue;
    }
  }
  return Object.keys(preferences).length ? preferences : undefined;
}

function normalizeMessagingConversationId(value: unknown): string | undefined {
  const conversationId = optionalTrimmedString(value, 160);
  return conversationId && /^[A-Za-z0-9_.:-]{1,160}$/u.test(conversationId) ? conversationId : undefined;
}

function normalizeMatrixRoomId(value: unknown): string | undefined {
  const roomId = optionalTrimmedString(value, 512);
  return roomId && /^![^\s:]+:.+$/u.test(roomId) ? roomId : undefined;
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
  const roomId = normalizeMatrixRoomId(value.roomId);
  if (!roomId) {
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

function parseIncidentQuery(query: Record<string, unknown>): IncidentQuery {
  const bbox = parseBboxQuery(query.bbox);
  const categories = parseIncidentCategories(query.category ?? query.categories);
  const statuses = parseIncidentStatuses(query.status ?? query.statuses);
  return {
    ...(bbox ? { bbox } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    includeClosed: query.includeClosed === "true" || query.includeClosed === true,
    limit: optionalFiniteNumber(query.limit, 1, 500) ?? 100,
    ...(statuses.length > 0 ? { statuses } : {})
  };
}

function parseIncidentTaskQuery(incidentId: string, query: Record<string, unknown>): IncidentTaskQuery {
  const statuses = parseIncidentTaskStatuses(query.status ?? query.statuses);
  return {
    incidentId,
    limit: optionalFiniteNumber(query.limit, 1, 500) ?? 100,
    ...(statuses.length > 0 ? { statuses } : {})
  };
}

function parseIncidentCategories(value: unknown): IncidentCategory[] {
  return normalizeCsv(value).filter(isIncidentCategory);
}

function parseIncidentStatuses(value: unknown): IncidentStatus[] {
  return normalizeCsv(value).filter(isIncidentStatus);
}

function parseIncidentTaskStatuses(value: unknown): IncidentTaskStatus[] {
  return normalizeCsv(value).filter(isIncidentTaskStatus);
}

function normalizeCreateIncidentRequest(value: unknown, actor: AuthenticatedActor): CreateIncidentInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = optionalTrimmedString(value.title, 160);
  const category = isIncidentCategory(value.category) ? value.category : undefined;
  const severity = isIncidentSeverity(value.severity) ? value.severity : undefined;
  const location = normalizeIncidentLocation(value.location, "manual");
  if (!title || !category || !severity || !location) {
    return null;
  }
  const confidence = optionalFiniteNumber(value.confidence, 0, 1);
  const description = optionalTrimmedString(value.description, 2000);
  return {
    category,
    ...(confidence !== undefined ? { confidence } : {}),
    createdBy: actorToIncidentActor(actor),
    ...(description ? { description } : {}),
    location,
    properties: normalizedJsonRecord(value.properties, 12000),
    provenance: normalizeIncidentProvenance(value.provenance),
    severity,
    sourceRefs: normalizeIncidentSourceRefs(value.sourceRefs),
    status: isIncidentStatus(value.status) ? value.status : "candidate",
    title
  };
}

function normalizeUpdateIncidentRequest(value: unknown): IncidentUpdateInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const update: IncidentUpdateInput = {};
  const title = optionalTrimmedString(value.title, 160);
  if (title) {
    update.title = title;
  }
  if (hasOwn(value, "description")) {
    update.description = optionalTrimmedString(value.description, 2000) ?? null;
  }
  if (isIncidentCategory(value.category)) {
    update.category = value.category;
  }
  if (isIncidentSeverity(value.severity)) {
    update.severity = value.severity;
  }
  if (isIncidentStatus(value.status)) {
    update.status = value.status;
  }
  const confidence = optionalFiniteNumber(value.confidence, 0, 1);
  if (confidence !== undefined) {
    update.confidence = confidence;
  }
  const location = normalizeIncidentLocation(value.location, "manual");
  if (location) {
    update.location = location;
  }
  if (hasOwn(value, "properties")) {
    update.properties = normalizedJsonRecord(value.properties, 12000);
  }
  if (hasOwn(value, "provenance")) {
    update.provenance = normalizeIncidentProvenance(value.provenance);
  }
  if (hasOwn(value, "sourceRefs")) {
    update.sourceRefs = normalizeIncidentSourceRefs(value.sourceRefs);
  }
  return Object.keys(update).length > 0 ? update : null;
}

function normalizeCreateIncidentTaskRequest(incidentId: string, value: unknown, actor: AuthenticatedActor): CreateIncidentTaskInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = optionalTrimmedString(value.title, 160);
  if (!title) {
    return null;
  }
  const assigneeSubjectId = optionalTrimmedString(value.assigneeSubjectId, 160);
  const description = optionalTrimmedString(value.description, 2000);
  const dueAt = optionalIsoTimestamp(value.dueAt);
  const sourceRef = normalizeIncidentSourceRef(value.sourceRef);
  return {
    ...(assigneeSubjectId ? { assigneeSubjectId } : {}),
    createdBy: actorToIncidentActor(actor),
    ...(description ? { description } : {}),
    ...(dueAt ? { dueAt } : {}),
    incidentId,
    priority: isIncidentTaskPriority(value.priority) ? value.priority : "normal",
    properties: normalizedJsonRecord(value.properties, 8000),
    ...(sourceRef ? { sourceRef } : {}),
    status: isIncidentTaskStatus(value.status) ? value.status : "open",
    title
  };
}

function normalizeUpdateIncidentTaskRequest(value: unknown): IncidentTaskUpdateInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const update: IncidentTaskUpdateInput = {};
  const title = optionalTrimmedString(value.title, 160);
  if (title) {
    update.title = title;
  }
  if (hasOwn(value, "description")) {
    update.description = optionalTrimmedString(value.description, 2000) ?? null;
  }
  if (hasOwn(value, "assigneeSubjectId")) {
    update.assigneeSubjectId = optionalTrimmedString(value.assigneeSubjectId, 160) ?? null;
  }
  if (hasOwn(value, "dueAt")) {
    update.dueAt = optionalIsoTimestamp(value.dueAt) ?? null;
  }
  if (isIncidentTaskPriority(value.priority)) {
    update.priority = value.priority;
  }
  if (isIncidentTaskStatus(value.status)) {
    update.status = value.status;
  }
  if (hasOwn(value, "properties")) {
    update.properties = normalizedJsonRecord(value.properties, 8000);
  }
  if (hasOwn(value, "sourceRef")) {
    update.sourceRef = normalizeIncidentSourceRef(value.sourceRef) ?? null;
  }
  return Object.keys(update).length > 0 ? update : null;
}

function normalizeIncidentLocation(value: unknown, fallbackSource: IncidentLocationSource): IncidentLocation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const lat = optionalFiniteNumber(value.lat, -90, 90);
  const lon = optionalFiniteNumber(value.lon, -180, 180);
  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  const accuracyM = optionalFiniteNumber(value.accuracyM, 0, 100000);
  const label = optionalTrimmedString(value.label, 160);
  return {
    ...(accuracyM !== undefined ? { accuracyM } : {}),
    ...(label ? { label } : {}),
    lat,
    lon,
    source: isIncidentLocationSource(value.source) ? value.source : fallbackSource
  };
}

function normalizeIncidentProvenance(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizedJsonRecord(item, 4000))
    .filter((item) => Object.keys(item).length > 0)
    .slice(0, 20);
}

function normalizeIncidentSourceRefs(value: unknown): IncidentSourceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeIncidentSourceRef)
    .filter((item): item is IncidentSourceRef => Boolean(item))
    .slice(0, 50);
}

function normalizeIncidentSourceRef(value: unknown): IncidentSourceRef | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = optionalTrimmedString(value.id, 220);
  const kind = isIncidentSourceRefKind(value.kind) ? value.kind : undefined;
  if (!id || !kind) {
    return undefined;
  }
  const observedAt = optionalIsoTimestamp(value.observedAt);
  const sourceId = optionalTrimmedString(value.sourceId, 140);
  const title = optionalTrimmedString(value.title, 180);
  return {
    id,
    kind,
    ...(observedAt ? { observedAt } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(title ? { title } : {})
  };
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

function isIncidentCategory(value: unknown): value is IncidentCategory {
  return value === "community"
    || value === "fire"
    || value === "flood"
    || value === "infrastructure"
    || value === "medical"
    || value === "other"
    || value === "security"
    || value === "traffic"
    || value === "weather";
}

function isIncidentSeverity(value: unknown): value is IncidentSeverity {
  return value === "advisory" || value === "critical" || value === "info" || value === "warning";
}

function isIncidentStatus(value: unknown): value is IncidentStatus {
  return value === "active"
    || value === "candidate"
    || value === "closed"
    || value === "monitoring"
    || value === "rejected"
    || value === "resolved";
}

function isIncidentLocationSource(value: unknown): value is IncidentLocationSource {
  return value === "community_report" || value === "fusion" || value === "manual" || value === "provider";
}

function isIncidentSourceRefKind(value: unknown): value is IncidentSourceRefKind {
  return value === "alert"
    || value === "community_report"
    || value === "manual"
    || value === "provider_feature"
    || value === "sketch";
}

function isIncidentTaskPriority(value: unknown): value is IncidentTaskPriority {
  return value === "high" || value === "low" || value === "normal" || value === "urgent";
}

function isIncidentTaskStatus(value: unknown): value is IncidentTaskStatus {
  return value === "blocked" || value === "cancelled" || value === "done" || value === "in_progress" || value === "open";
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
    incidentFusionSuggestions: true,
    incidentTasks: true,
    incidents: true,
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
    incidentDetail: "/api/v1/incidents/{incidentId}",
    incidentFusionSuggestions: "/api/v1/incidents/fusion/suggestions",
    incidentTasks: "/api/v1/incidents/{incidentId}/tasks",
    incidents: "/api/v1/incidents",
    mapRasterOverlay: "/api/v1/map/raster-overlay?url={encodedUrl}",
    mapQuery: "/api/v1/map/query",
    offlineSnapshot: "/api/v1/mobile/offline-snapshot",
    preferences: "/api/v1/me/preferences",
    userDirectorySearch: "/api/v1/users/search",
    mapCatalog: "/api/v1/map/catalog",
    messagingBootstrap: "/api/v1/messaging/bootstrap",
    messagingConversationDetail: "/api/v1/messaging/conversations/{conversationId}",
    messagingConversationResolve: "/api/v1/messaging/conversations/resolve?roomId={roomId}",
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
    language: optionalString(value.language, ["cs", "en"]),
    mapClusterEnabled: optionalBoolean(value.mapClusterEnabled),
    mapBasemapMode: optionalString(value.mapBasemapMode, ["standard", "civil", "risk", "dark", "outline"]),
    mapView: normalizeMapViewPreference(value.mapView),
    minConfidence: optionalFiniteNumber(value.minConfidence, 0, 1),
    operatorProfile: normalizeOperatorProfilePreference(value.operatorProfile),
    predictionMinutes: optionalFiniteNumber(value.predictionMinutes, 2, 20),
    predictionMode: optionalString(value.predictionMode, ["adaptive", "telemetry", "history", "maneuver"]),
    proximityAlertEnabled: optionalBoolean(value.proximityAlertEnabled),
    publicFlightSymbolMode: optionalString(value.publicFlightSymbolMode, ["civil", "standard"]),
    refreshSeconds: optionalFiniteNumber(value.refreshSeconds, 1, 60),
    selectedLayer: optionalString(value.selectedLayer, ["air-situation", "sim-air", "uav", "friendly", "foreign", "public-flights", "data-quality"]),
    showAlertAreas: optionalBoolean(value.showAlertAreas),
    showHistory: optionalBoolean(value.showHistory),
    showPrediction: optionalBoolean(value.showPrediction),
    safetyLayerIds: optionalStringArray(value.safetyLayerIds, ["boundary_admin", "fire", "flood", "warnings", "weather_alerts"]),
    situationLayerIds: optionalStringArray(value.situationLayerIds, [
      "weather",
      "weather_temperature_grid",
      "weather_wind_field",
      "weather_precipitation_grid",
      "weather_humidity_grid",
      "weather_pressure_grid",
      "weather_radar_reflectivity",
      "weather_radar_precipitation",
      "weather_radar_nowcast",
      "weather_thunderstorm_risk",
      "ground",
      "mobile",
      "mobile_network",
      "mobile_coverage",
      "traffic",
      "air_quality",
      "air_quality_grid",
      "boundary_admin",
      "boundary_country",
      "boundary_region",
      "boundary_district",
      "boundary_orp",
      "boundary_municipality",
      "place_settlements"
    ]),
    situationSourceIds: normalizeStringList(value.situationSourceIds, 32, 80),
    takLayerIds: optionalStringArray(value.takLayerIds, ["mobile", "ground", "traffic"]),
    trackLayerIds: optionalStringArray(value.trackLayerIds, ["air-situation", "sim-air", "uav", "friendly", "foreign", "public-flights", "data-quality"]),
    trackHistoryDisplayMode: optionalString(value.trackHistoryDisplayMode, ["all", "selected"]),
    trackHistoryLimit: optionalFiniteNumber(value.trackHistoryLimit, 1, 1000),
    trackHistoryWindowSeconds: optionalFiniteNumber(value.trackHistoryWindowSeconds, 1, 3600),
    workspaceLayout: normalizeWorkspaceLayoutPreference(value.workspaceLayout),
    workspaceSkin: optionalString(value.workspaceSkin, ["civil", "operations", "field"])
  });
}

function normalizeOperatorProfilePreference(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return compactRecord({
    avatarDataUrl: optionalImageDataUrl(value.avatarDataUrl),
    contactNote: optionalTrimmedString(value.contactNote, 280),
    displayName: optionalTrimmedString(value.displayName, 80),
    email: optionalTrimmedString(value.email, 120),
    organization: optionalTrimmedString(value.organization, 120),
    phone: optionalTrimmedString(value.phone, 40),
    publicContact: optionalBoolean(value.publicContact),
    role: optionalTrimmedString(value.role, 80)
  });
}

function normalizeWorkspaceLayoutPreference(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return compactRecord({
    contextRailVisible: optionalBoolean(value.contextRailVisible),
    leftPanelMode: optionalString(value.leftPanelMode, ["open", "collapsed", "hidden"]),
    leftPanelWidth: optionalFiniteNumber(value.leftPanelWidth, 220, 460),
    rightPanelMode: optionalString(value.rightPanelMode, ["open", "collapsed", "hidden"]),
    rightPanelWidth: optionalFiniteNumber(value.rightPanelWidth, 280, 560),
    statusbarVisible: optionalBoolean(value.statusbarVisible)
  });
}

function optionalImageDataUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/iu.test(value) && value.length <= 250_000
    ? value
    : undefined;
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
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && !(Array.isArray(entry) && entry.length === 0))
  );
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

function parseRasterOverlayUrl(value: string | undefined, situationDataBaseUrl: string): URL | null {
  if (!value) {
    return null;
  }
  if (value.startsWith("/")) {
    return resolveSituationDataRelativeUrl(value, situationDataBaseUrl);
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function resolveSituationDataRelativeUrl(value: string, situationDataBaseUrl: string): URL | null {
  if (!value.startsWith("/api/v1/weather-radar/clean/") && !value.startsWith("/weather-radar/clean/")) {
    return null;
  }
  const normalizedPath = value.startsWith("/api/v1/")
    ? value.slice("/api/v1/".length)
    : value.replace(/^\/+/, "");
  try {
    return new URL(normalizedPath, `${trimTrailingSlash(situationDataBaseUrl)}/`);
  } catch {
    return null;
  }
}

function parseWeatherCameraResourceUrl(value: string | undefined, situationDataBaseUrl: string): URL | null {
  if (!value) {
    return null;
  }
  if (value.startsWith("/")) {
    return resolveSituationDataCameraRelativeUrl(value, situationDataBaseUrl);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return isWeatherCameraPath(url.pathname) ? url : null;
  } catch {
    return null;
  }
}

function resolveSituationDataCameraRelativeUrl(value: string, situationDataBaseUrl: string): URL | null {
  try {
    const baseUrl = new URL(`${trimTrailingSlash(situationDataBaseUrl)}/`);
    const inputUrl = new URL(value, "https://cop.local");
    let normalizedPath = inputUrl.pathname;
    const basePath = baseUrl.pathname.replace(/\/+$/u, "");
    if (normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`)) {
      normalizedPath = normalizedPath.slice(basePath.length);
    } else if (normalizedPath.startsWith("/api/v1/")) {
      normalizedPath = normalizedPath.slice("/api/v1/".length);
    }
    normalizedPath = normalizedPath.replace(/^\/+/u, "");
    if (!isWeatherCameraPath(normalizedPath)) {
      return null;
    }
    const resolved = new URL(normalizedPath, baseUrl);
    resolved.search = inputUrl.search;
    return resolved;
  } catch {
    return null;
  }
}

function isWeatherCameraPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return normalized.includes("webcam")
    || normalized.includes("camera")
    || normalized.startsWith("weather/");
}

function isAllowedWeatherCameraUrl(url: URL, env: Record<string, string | undefined> = process.env): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "chmi.cz" || hostname.endsWith(".chmi.cz")) {
    return false;
  }
  const allowedHosts = new Set((env.COP_WEATHER_CAMERA_ALLOWED_HOSTS ?? defaultWeatherCameraAllowedHosts)
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));
  return allowedHosts.has(hostname);
}

function isAllowedRasterOverlayUrl(url: URL, env: Record<string, string | undefined> = process.env): boolean {
  const allowedHosts = new Set((env.COP_RASTER_OVERLAY_ALLOWED_HOSTS ?? defaultRasterOverlayAllowedHosts)
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    return false;
  }
  if (!/\.(png|jpg|jpeg|webp)$/iu.test(url.pathname)) {
    return false;
  }
  return true;
}

async function fetchWeatherCameraResource(url: URL): Promise<Response> {
  const timeoutMs = readPositiveInteger(process.env.COP_WEATHER_CAMERA_TIMEOUT_MS, 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url.toString(), {
      headers: {
        accept: "application/json,image/png,image/webp,image/jpeg,image/*;q=0.8,*/*;q=0.1",
        "user-agent": "CSM-COP weather camera proxy"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRasterOverlay(url: URL): Promise<Response> {
  const timeoutMs = readPositiveInteger(process.env.COP_RASTER_OVERLAY_TIMEOUT_MS, 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url.toString(), {
      headers: {
        accept: "image/png,image/webp,image/jpeg,image/*;q=0.8,*/*;q=0.1",
        "user-agent": "CSM-COP raster overlay proxy"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWeatherRadarFrames(url: URL, timeoutMsOverride?: number): Promise<unknown> {
  const timeoutMs = timeoutMsOverride ?? readPositiveInteger(process.env.COP_SITUATION_DATA_TIMEOUT_MS, 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "CSM-COP weather radar frame proxy"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`SIM weather radar frame catalog returned HTTP ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function optionalRadarProduct(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return /^[a-z0-9_-]{1,64}$/iu.test(normalized) ? normalized : undefined;
}

function boundedQueryInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? boundedInteger(Math.trunc(parsed), min, max) : fallback;
}

function boundedInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
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

function mcpJsonRpcId(value: unknown): McpJsonRpcId | undefined {
  if (typeof value === "string" || typeof value === "number" || value === null) {
    return value;
  }
  return undefined;
}

function mcpJsonRpcResult(id: McpJsonRpcId | undefined, result: Record<string, unknown>): Record<string, unknown> | undefined {
  if (id === undefined) {
    return undefined;
  }
  return {
    id,
    jsonrpc: "2.0",
    result
  };
}

function mcpJsonRpcError(
  id: McpJsonRpcId | undefined,
  code: number,
  message: string,
  data?: unknown
): Record<string, unknown> | undefined {
  if (id === undefined) {
    return undefined;
  }
  return {
    error: {
      code,
      ...(data === undefined ? {} : { data }),
      message
    },
    id,
    jsonrpc: "2.0"
  };
}

function aiRequestId(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : crypto.randomUUID();
}

function aiLanguage(value: unknown): "cs" | "en" {
  return value === "en" ? "en" : "cs";
}

function readBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function summarizeObjectForAi(object: ObservedObject): Record<string, unknown> {
  const conflict = isRecord(object.attributes?.conflictEvidence) ? object.attributes.conflictEvidence : undefined;
  return compactRecord({
    affiliation: object.affiliation,
    confidence: object.confidence,
    dataQuality: object.dataQuality,
    domain: object.domain,
    headingDeg: object.headingDeg ?? object.movement?.headingDeg ?? undefined,
    lastUpdatedAt: object.lastUpdatedAt,
    objectId: object.objectId,
    objectType: object.objectType,
    position: object.position
      ? {
          lat: roundCoordinate(object.position.lat),
          lon: roundCoordinate(object.position.lon)
        }
      : undefined,
    sourceSystemIds: object.provenance?.map((item) => item.sourceSystemId).filter(Boolean).slice(0, 5),
    speedMps: object.speedMps ?? object.movement?.speedMps ?? undefined,
    status: object.status,
    synthetic: object.synthetic,
    validUntil: object.validUntil,
    warning: conflict ? "conflict evidence present" : undefined
  });
}

function summarizeAlertForAi(alert: CopAlert): Record<string, unknown> {
  return compactRecord({
    alertId: alert.alertId,
    detail: alert.detail,
    objectId: alert.objectId,
    observedAt: alert.observedAt,
    severity: alert.severity,
    sourceSystemId: alert.sourceSystemId,
    status: alert.status,
    title: alert.title,
    type: alert.type,
    updatedAt: alert.updatedAt
  });
}

function summarizeSourceHealthForAi(source: SourceHealthItem): Record<string, unknown> {
  return compactRecord({
    acceptedEvents: source.acceptedEvents,
    avgConfidence: source.avgConfidence,
    currentTracks: source.currentTracks,
    detail: source.detail,
    displayName: source.displayName,
    expiredTracks: source.expiredTracks,
    health: source.health,
    lastObservationAgeSeconds: source.lastObservationAgeSeconds,
    lowConfidenceTracks: source.lowConfidenceTracks,
    sourceSystemId: source.sourceSystemId,
    sourceType: source.sourceType,
    staleTracks: source.staleTracks,
    status: source.status,
    totalTracks: source.totalTracks,
    warnings: source.warnings?.slice(0, 5)
  });
}

function summarizeLocationForAi(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const lat = optionalFiniteNumber(value.lat, -90, 90);
  const lon = optionalFiniteNumber(value.lon, -180, 180);
  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  return compactRecord({
    accuracyM: optionalFiniteNumber(value.accuracyM, 0, 100000),
    lat: roundCoordinate(lat),
    lon: roundCoordinate(lon),
    source: optionalText(value.source)
  });
}

function aiAuditMetadata(response: AiCopResponse, actor: AuthenticatedActor): Record<string, unknown> {
  return {
    actorAuthMode: actor.authMode,
    actorSubjectId: actor.subjectId,
    auditId: response.auditId,
    model: response.model,
    provider: response.provider,
    requestId: response.requestId,
    status: response.status
  };
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100000) / 100000;
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

function aiHealthDependencyTimeoutMs(): number {
  return readPositiveInteger(process.env.COP_AI_HEALTH_DEPENDENCY_TIMEOUT_MS, 10000);
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
