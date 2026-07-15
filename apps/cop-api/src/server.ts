import compress from "@fastify/compress";
import cors, { type FastifyCorsOptions } from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import underPressure from "@fastify/under-pressure";
import websocket from "@fastify/websocket";
import { AiGateway, type AiCopQuery, type AiCopResponse, type AiModelPreference } from "@cop/ai-gateway";
import {
  createCopObjectFromEvent,
  type CanonicalEventEnvelope,
  type ObservedObject,
  type SourceSystem
} from "@cop/canonical-model";
import { ContractValidators, formatValidationErrors } from "@cop/ingest-contracts";
import { resolveSymbolFromRequest } from "@cop/nato-symbol-renderer";
import { defaultSystemSubject, evaluateReadPolicy } from "@cop/policy-engine";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { buildCopAlerts, type AoiRule, type AoiRuleAffiliationScope, type CopAlert } from "./alerts.js";
import {
  createCommunityReportStoreFromEnv,
  InMemoryCommunityReportStore,
  type CommunityGroupMemberRole,
  type CommunityGroupMemberStatus,
  type CommunityGroupRecord,
  type CommunityGroupVisibility,
  type LeaveCommunityGroupResult,
  type RemoveCommunityGroupMemberResult,
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
import {
  aiMapSearchFallbackResponse,
  aiMapSearchNoResultFallbackResponse,
  aiMapSearchResultCompare,
  aiMapActionsFromMapSearchContext,
  aiMapCatalogLayerMatchesMapSearchIntent,
  aiSituationFeatureMatchesMapSearchIntent,
  bboxForAiMapSearchGeoFilter,
  dedupeAiMapSearchResults,
  inferAiMapSearchIntent,
  simSearchSourceSystemsForAiMapSearchIntent,
  simSearchEntityTypesForAiMapSearchIntent,
  summarizeGeocodedPlaceForAi,
  summarizeMapFeatureCollectionForAi,
  summarizeSimSearchResponseForAi,
  summarizeSituationMapFeatureForAi,
  type AiMapAction,
  type AiMapSearchContext,
  type AiMapSearchResult
} from "./ai-map-search.js";
import {
  AiContextIndex,
  type AiContextGeoFilter,
  type AiContextIndexRefreshResult,
  type AiContextTimeWindow,
  type AiIndexedContext
} from "./ai-context-index.js";
import { buildAiPromptContextCompression } from "./ai-context-compression.js";
import {
  aiIntentSuppressesRoutineCivilAir,
  buildAiRetrievalQuery,
  inferAiRetrievalIntent,
  isRoutineCivilAirText,
  type AiRetrievalIntent
} from "./ai-retrieval-intent.js";
import { aiResponsePlaybookGuidanceForQuestion, aiResponsePlaybookPromptGuidance } from "./ai-response-playbook.js";
import {
  AiSemanticRetriever,
  createSemanticDocuments,
  type AiSemanticContext,
  type AiSemanticDocument
} from "./ai-semantic-retrieval.js";
import { createCopStreamBusFromEnv, type CopStreamBus } from "./cop-stream-bus.js";
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
  type MessagingConversationCreateResponse,
  type MessagingConversationMember,
  type MessagingE2eeResetAuthRequest,
  type MessagingMatrixBootstrap,
  type MessagingMatrixRoomBindingRequest,
  type MessagingMapLink,
  type MessagingProvider,
  type MessagingWebPushDeviceRegistrationRequest
} from "./messaging-provider.js";
import {
  createMobileDeviceStoreFromEnv,
  InMemoryMobileDeviceStore,
  type MobileDeviceRecord,
  type MobileDeviceRegistrationInput,
  type MobileDeviceStore,
  type MobileMeshAckRecord,
  type MobileMeshBundleIngestInput,
  type MobilePairingActorRecord,
  type MobilePairingSessionRecord,
  type MobilePlatform
} from "./mobile-device-store.js";
import {
  buildCommunityReportNotificationDecision,
  buildSafetyFeatureNotificationDecision,
  type CopNotificationAudience,
  type CopNotificationDecision
} from "./notification-decision.js";
import { createPlaceGeocoderFromEnv, type PlaceGeocodeResult, type PlaceGeocoder } from "./place-geocoder.js";
import { buildCopPrometheusMetrics } from "./prometheus-metrics.js";
import { withEventProvenance } from "./provenance.js";
import { registerCommunityGroupRoutes, registerCommunityReportRoutes } from "./routes/community-routes.js";
import { registerHealthRoutes } from "./routes/health-routes.js";
import { registerMessagingRoutes } from "./routes/messaging-routes.js";
import { registerMobileRoutes } from "./routes/mobile-routes.js";
import { registerRadioRoutes } from "./routes/radio-routes.js";
import { registerRoutingRoutes } from "./routes/routing-routes.js";
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
  type MobileTowerViewshedQuery,
  type RadioCoverageRequest,
  type RadioLinkCheckRequest,
  type RadioPoint,
  type RadioProfile,
  type RadioProfileRequestBase,
  type RadioSiteSearchRequest,
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
  buildSimSearchDataHealth,
  createSimSearchDataSourceFromEnv,
  unavailableSimSearchDataHealth,
  type SimSearchDataSource,
  type SimSearchEntitiesResponse
} from "./sim-search-data-source.js";
import { createRoutingSourceFromEnv, type RoutingRouteRequest, type RoutingSource } from "./routing-source.js";
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
import {
  appendTrackHistory,
  parseTrackHistoryQuery,
  queryTrackHistory,
  type TrackHistoryQuery
} from "./temporal-history.js";
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
  aiGateway?: AiGateway;
  flightDataSource?: FlightDataSource;
  communityReportStore?: CommunityReportStore;
  incidentStore?: IncidentStore;
  federationRuntimeStore?: FederationRuntimeStore;
  mediaStorage?: MediaStorage;
  messagingProvider?: MessagingProvider;
  missionArenaSource?: MissionArenaSource;
  placeGeocoder?: PlaceGeocoder;
  routingSource?: RoutingSource;
  safetyDataSource?: SafetyDataSource;
  sketchDrawingStore?: SketchDrawingStore;
  simSearchDataSource?: SimSearchDataSource;
  situationDataSource?: SituationDataSource;
  takGatewaySource?: TakGatewaySource;
  state?: CopState;
  logger?: boolean;
  now?: () => Date;
  trackHistoryStore?: TrackHistoryStore;
  trackLifecycle?: TrackLifecycleConfig;
  streamBus?: CopStreamBus;
  streamBroadcaster?: CopStreamBroadcaster;
  mobileDeviceStore?: MobileDeviceStore;
  userProfileStore?: UserProfileStore;
}

type DependencyStatus = "disabled" | "degraded" | "ok";
type CommunityReportHazardSeverity = "advisory" | "warning" | "critical";
type AiChatAgentJobStatus = "completed" | "failed" | "queued" | "running";

interface AiChatAgentJobRecord {
  actorSubjectId: string;
  createdAt: string;
  error?: {
    message: string;
    statusCode?: number;
  };
  expiresAt: string;
  jobId: string;
  requestId?: string;
  response?: AiCopResponse;
  status: AiChatAgentJobStatus;
  updatedAt: string;
}

type AiMatrixBotProvisionStatus =
  | "bot_disabled"
  | "bot_join_failed"
  | "bot_token_unavailable"
  | "joined"
  | "member_sync_failed"
  | "pending_conversation"
  | "pending_room_binding";
const defaultRasterOverlayAllowedHosts = "docker.home.cz,sim.zeleznalady.cz";
const rasterOverlayMaxBytes = 8 * 1024 * 1024;
const defaultWeatherCameraAllowedHosts = defaultRasterOverlayAllowedHosts;
const weatherCameraMaxBytes = 12 * 1024 * 1024;
const defaultApiAllowedOrigins = [
  "http://localhost:4311",
  "http://localhost:4314",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:4311",
  "http://127.0.0.1:4314",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://docker.home.cz:4311",
  "http://docker.home.cz:4314",
  "https://cop.zeleznalady.cz"
];

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
  | "cop.community.reports.search"
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
    description:
      "Build a compact, policy-filtered situation summary for an area from COP map providers. The tool returns sources, uncertainty and confidence; it never changes state.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        bbox: {
          description:
            "Bounding box as [west,south,east,north] or {west,south,east,north}. Defaults to the flood PoC area.",
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
    description:
      "Search policy-filtered submitted and published community reports in an area. The tool returns report facts and provenance without chat messages, author identities or media URLs.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        bbox: {
          description: "Bounding box as [west,south,east,north] or {west,south,east,north}.",
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
        categories: {
          items: {
            enum: [
              "fire",
              "flood",
              "bridge_damage",
              "road_blockage",
              "infrastructure_damage",
              "medical",
              "utility_outage",
              "hazard",
              "other"
            ],
            type: "string"
          },
          maxItems: 9,
          type: "array"
        },
        includeExpired: { type: "boolean" },
        limit: { maximum: 200, minimum: 1, type: "integer" },
        severities: {
          items: { enum: ["advisory", "warning", "critical"], type: "string" },
          maxItems: 3,
          type: "array"
        }
      },
      required: ["bbox"],
      type: "object"
    },
    mode: "read_only",
    output: "cop-community-report-search-v1",
    title: "Search community reports",
    toolId: "cop.community.reports.search"
  },
  {
    description:
      "Explain deterministic fusion priorities for an area by correlating COP map evidence across providers. The tool returns evidence, confidence and uncertainty; it never creates or updates incidents.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        bbox: {
          description:
            "Bounding box as [west,south,east,north] or {west,south,east,north}. Defaults to the flood PoC area.",
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
    description:
      "List current COP source health for AI and operator diagnostics. The tool returns structured source status, warnings and freshness metrics; it never changes source configuration.",
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

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const maxCommunityAttachmentBytes = readPositiveInteger(process.env.COP_MEDIA_MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024);
  const app = Fastify({
    bodyLimit: readPositiveInteger(
      process.env.COP_API_BODY_LIMIT_BYTES,
      Math.max(1024 * 1024, maxCommunityAttachmentBytes * 2)
    ),
    logger: options.logger ?? false
  });
  const state = options.state ?? createInitialState();
  const validators = new ContractValidators();
  const aiGateway = options.aiGateway ?? AiGateway.fromEnv(process.env);
  const aiSemanticRetriever = new AiSemanticRetriever({
    embedText: (input) => aiGateway.embedText(input),
    enabled: readBoolean(process.env.COP_AI_SEMANTIC_RETRIEVAL_ENABLED, true),
    maxCacheEntries: readPositiveInteger(process.env.COP_AI_SEMANTIC_RETRIEVAL_CACHE_ENTRIES, 500),
    maxDocuments: readPositiveInteger(process.env.COP_AI_SEMANTIC_RETRIEVAL_MAX_DOCUMENTS, 12)
  });
  const aiContextIndex = new AiContextIndex({
    enabled: readBoolean(process.env.COP_AI_CONTEXT_INDEX_ENABLED, true),
    maxDocuments: readPositiveInteger(process.env.COP_AI_CONTEXT_INDEX_MAX_DOCUMENTS, 800)
  });
  const aiContextIndexRefreshSeconds = readPositiveInteger(process.env.COP_AI_CONTEXT_INDEX_REFRESH_SECONDS, 120);
  const aiContextIndexMaxAgeMs = aiContextIndexRefreshSeconds * 1000;
  const aiContextIndexQueryLimit = readPositiveInteger(process.env.COP_AI_CONTEXT_INDEX_QUERY_LIMIT, 8);
  const aiContextIndexLookbackSeconds = readPositiveInteger(
    process.env.COP_AI_CONTEXT_INDEX_LOOKBACK_SECONDS,
    7 * 24 * 3600
  );
  const aiContextIndexDefaultRadiusKm = readPositiveInteger(process.env.COP_AI_CONTEXT_INDEX_DEFAULT_RADIUS_KM, 30);
  const aiContextIndexObjectLimit = readPositiveInteger(process.env.COP_AI_CONTEXT_INDEX_OBJECT_LIMIT, 250);
  const aiContextIndexCommunityReportLimit = readPositiveInteger(
    process.env.COP_AI_CONTEXT_INDEX_COMMUNITY_REPORT_LIMIT,
    250
  );
  const aiContextIndexIncidentLimit = readPositiveInteger(process.env.COP_AI_CONTEXT_INDEX_INCIDENT_LIMIT, 200);
  const aiContextIndexSimSearchEntityLimit = readPositiveInteger(
    process.env.COP_AI_CONTEXT_INDEX_SIM_SEARCH_ENTITY_LIMIT,
    1000
  );
  const aiSemanticRetrievalCandidateLimit = readPositiveInteger(
    process.env.COP_AI_SEMANTIC_RETRIEVAL_CANDIDATE_LIMIT,
    36
  );
  const aiSemanticRetrievalTimeoutMs = readPositiveInteger(process.env.COP_AI_SEMANTIC_RETRIEVAL_TIMEOUT_MS, 20000);
  const aiGatewayRequestTimeoutMs = readPositiveInteger(process.env.COP_AI_REQUEST_TIMEOUT_MS, 70000);
  const aiChatAgentJobTtlMs = readPositiveInteger(process.env.COP_AI_CHAT_AGENT_JOB_TTL_SECONDS, 20 * 60) * 1000;
  const aiChatAgentJobs = new Map<string, AiChatAgentJobRecord>();
  const now = options.now ?? (() => new Date());
  const trackLifecycle = options.trackLifecycle ?? createTrackLifecycleConfig();
  const trackHistoryStore = options.trackHistoryStore ?? createTrackHistoryStoreFromEnv();
  const federationRuntimeStore = options.federationRuntimeStore ?? createFederationRuntimeStoreFromEnv();
  const streamBroadcaster = options.streamBroadcaster ?? createStreamBroadcasterFromEnv();
  const streamBus = options.streamBus ?? createCopStreamBusFromEnv();
  const unsubscribeStreamBus = streamBus.subscribe((message) => streamBroadcaster.publishMessage(message));
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
  const mobileDeviceStore = options.mobileDeviceStore ?? createMobileDeviceStoreFromEnv();
  const mobileDeviceFallbackStore = new InMemoryMobileDeviceStore("memory-fallback");
  const missionArenaSource = options.missionArenaSource ?? createMissionArenaSourceFromEnv();
  const placeGeocoder = options.placeGeocoder ?? createPlaceGeocoderFromEnv();
  const flightDataSource = options.flightDataSource ?? createFlightDataSourceFromEnv();
  const safetyDataSource = options.safetyDataSource ?? createSafetyDataSourceFromEnv();
  const simSearchDataSource = options.simSearchDataSource ?? createSimSearchDataSourceFromEnv();
  const situationDataSource = options.situationDataSource ?? createSituationDataSourceFromEnv();
  const situationDataBaseUrl = situationDataSource?.config.baseUrl ?? createSituationDataSourceConfigFromEnv().baseUrl;
  const routingSource = options.routingSource ?? createRoutingSourceFromEnv();
  const takGatewaySource = options.takGatewaySource ?? createTakGatewaySourceFromEnv();
  const weatherRadarFramesCache = new Map<string, WeatherRadarFramesCacheEntry>();
  const edgeReplayCursors = new Map<string, EdgeReplayCursorRecord>();
  let federationRuntimeStoreStatus: DependencyStatus = federationRuntimeStore ? "degraded" : "disabled";
  let federationRuntimeStoreDetail = federationRuntimeStore
    ? `${federationRuntimeStore.name}: initializing`
    : "in-memory only";
  let trackHistoryStoreStatus: DependencyStatus = trackHistoryStore ? "degraded" : "disabled";
  let trackHistoryStoreDetail = trackHistoryStore ? `${trackHistoryStore.name}: initializing` : "in-memory only";
  let userProfileStoreStatus: DependencyStatus = "degraded";
  let userProfileStoreDetail = `${userProfileStore.name}: initializing`;
  let userProfileStoreRecovery: Promise<boolean> | undefined;
  let communityReportStoreStatus: DependencyStatus = communityReportStore ? "degraded" : "disabled";
  let communityReportStoreDetail = communityReportStore ? `${communityReportStore.name}: initializing` : "disabled";
  let incidentStoreStatus: DependencyStatus = incidentStore ? "degraded" : "disabled";
  let incidentStoreDetail = incidentStore ? `${incidentStore.name}: initializing` : "disabled";
  let sketchDrawingStoreStatus: DependencyStatus = sketchDrawingStore ? "degraded" : "disabled";
  let sketchDrawingStoreDetail = sketchDrawingStore ? `${sketchDrawingStore.name}: initializing` : "disabled";
  let mediaStorageStatus: DependencyStatus = mediaStorage ? "degraded" : "disabled";
  let mediaStorageDetail = mediaStorage ? `${mediaStorage.name}: initializing` : "disabled";
  let mobileDeviceStoreStatus: DependencyStatus = "degraded";
  let mobileDeviceStoreDetail = `${mobileDeviceStore.name}: initializing`;
  let streamBusStatus: DependencyStatus = streamBus.name === "memory" ? "ok" : "degraded";
  let streamBusDetail = streamBus.diagnostics();
  let restoredCurrentTrackCount = 0;
  let flightDataPollTimer: ReturnType<typeof setInterval> | undefined;
  let aiContextIndexRefreshTimer: ReturnType<typeof setInterval> | undefined;
  let aiContextIndexRefreshInFlight: Promise<AiContextIndexRefreshResult> | undefined;
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
  if (simSearchDataSource) {
    state.sources.set(simSearchDataSource.sourceSystem.sourceSystemId, simSearchDataSource.sourceSystem);
  }
  if (takGatewaySource) {
    state.sources.set(takGatewaySource.sourceSystem.sourceSystemId, takGatewaySource.sourceSystem);
  }
  if (missionArenaSource) {
    state.sources.set(missionArenaSource.sourceSystem.sourceSystemId, missionArenaSource.sourceSystem);
  }
  void app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  });
  void app.register(compress, {
    global: true,
    threshold: readPositiveInteger(process.env.COP_API_COMPRESS_THRESHOLD_BYTES, 1024)
  });
  void app.register(cors, {
    origin: buildCorsOriginResolver(process.env.COP_API_ALLOWED_ORIGINS ?? process.env.COP_ALLOWED_ORIGINS)
  });
  void app.register(rateLimit, {
    global: true,
    max: readPositiveInteger(process.env.COP_API_RATE_LIMIT_MAX, 2400),
    timeWindow: process.env.COP_API_RATE_LIMIT_WINDOW ?? "1 minute"
  });
  void app.register(underPressure, {
    exposeStatusRoute: false,
    maxEventLoopDelay: readPositiveInteger(process.env.COP_API_MAX_EVENT_LOOP_DELAY_MS, 1000)
  });
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
    await initializeStreamBus();
    await initializeFederationRuntimeStore();
    await initializeUserProfileStore();
    await initializeMobileDeviceStore();
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
    await refreshAiContextIndex("startup", now());
    aiContextIndexRefreshTimer = setInterval(() => {
      void refreshAiContextIndex("background", now()).catch((error) => {
        app.log.warn({ error }, "AI context index refresh failed.");
      });
    }, aiContextIndexRefreshSeconds * 1000);
    aiContextIndexRefreshTimer.unref?.();
  });
  app.addHook("onClose", async () => {
    if (flightDataPollTimer) {
      clearInterval(flightDataPollTimer);
    }
    if (aiContextIndexRefreshTimer) {
      clearInterval(aiContextIndexRefreshTimer);
    }
    if (trackPersistenceFlushTimer) {
      clearTimeout(trackPersistenceFlushTimer);
      trackPersistenceFlushTimer = undefined;
    }
    if (!trackPersistenceFlushInFlight) {
      await flushQueuedTrackPersistence();
    }
    unsubscribeStreamBus();
    await streamBus.close();
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
    await mobileDeviceStore.close();
    await mobileDeviceFallbackStore.close();
  });

  registerHealthRoutes(app, {
    live: async () => ({
      status: "ok",
      timestamp: new Date().toISOString()
    }),
    ready: async () => ({
      status: "ok",
      timestamp: new Date().toISOString()
    }),
    dependencies: async () => {
      const messaging = await withDependencyTimeout("csm-messaging-provider", messagingDependency(), {
        detail: `Messaging provider dependency check timed out after ${healthDependencyTimeoutMs()} ms.`,
        name: "csm-messaging-provider",
        status: "degraded"
      });
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
          { name: "cop-stream-bus", status: streamBusDependencyStatus(), detail: streamBusDependencyDetail() },
          {
            name: "federation-runtime-store",
            status: federationRuntimeStoreStatus,
            detail: federationRuntimeStoreDependencyDetail()
          },
          { name: "track-history-store", status: trackHistoryStoreStatus, detail: trackHistoryStoreDependencyDetail() },
          { name: "user-profile-store", status: userProfileStoreStatus, detail: userProfileStoreDependencyDetail() },
          {
            name: "community-report-store",
            status: communityReportStoreStatus,
            detail: communityReportStoreDependencyDetail()
          },
          { name: "incident-store", status: incidentStoreStatus, detail: incidentStoreDependencyDetail() },
          {
            name: "sketch-drawing-store",
            status: sketchDrawingStoreStatus,
            detail: sketchDrawingStoreDependencyDetail()
          },
          { name: "media-storage", status: mediaStorageStatus, detail: mediaStorageDependencyDetail() },
          { name: "mobile-device-store", status: mobileDeviceStoreStatus, detail: mobileDeviceStoreDependencyDetail() },
          {
            name: "place-geocoder",
            status: placeGeocoder ? "ok" : "disabled",
            detail: placeGeocoder?.diagnostics?.() ?? "disabled"
          },
          aiContextIndexDependency(),
          messaging,
          ...(flightDataSource ? [flightDataDependency()] : []),
          ...(situationDataSource ? [situationDataDependency()] : []),
          ...(routingSource ? [routingDependency()] : []),
          ...(safetyDataSource ? [safetyDataDependency()] : []),
          ...(simSearchDataSource ? [simSearchDataDependency()] : []),
          ...(missionArenaSource ? [missionArenaDependency()] : []),
          ...(takGatewaySource ? [takGatewayDependency()] : []),
          aiGatewayDependency
        ]
      };
    },
    metrics: async (_request, reply) => {
      const currentObjects = selectCurrentTracks(state.objects.values(), now(), trackLifecycle);
      const trackHistoryPointCount = await countTrackHistoryPoints();
      const persistedCurrentTrackCount = await countPersistedCurrentTracks();
      return reply.type("text/plain").send(
        buildCopPrometheusMetrics({
          currentObjectCount: currentObjects.length,
          eventCount: state.events.size,
          persistedCurrentTrackCount,
          safetyCache: safetyDataSource?.cacheStats?.(),
          situationCache: situationDataSource?.cacheStats?.(),
          sourceCount: state.sources.size,
          streamBusMetrics: streamBus.metrics,
          streamMetrics: streamBroadcaster.metrics,
          takGatewayCache: takGatewaySource?.cacheStats?.(),
          trackHistoryPointCount
        })
      );
    }
  });

  async function initializeStreamBus(): Promise<void> {
    try {
      await streamBus.init();
      streamBusStatus = "ok";
      streamBusDetail = streamBus.diagnostics();
    } catch (error) {
      streamBusStatus = "degraded";
      streamBusDetail = `${streamBus.name}: ${errorMessage(error)}`;
      app.log.error({ error }, "COP stream bus initialization failed; live stream will remain local-only.");
    }
  }

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

  async function initializeMobileDeviceStore(): Promise<void> {
    try {
      await mobileDeviceStore.init();
      mobileDeviceStoreStatus = "ok";
      mobileDeviceStoreDetail = `${mobileDeviceStore.name}: ready`;
    } catch (error) {
      mobileDeviceStoreStatus = "degraded";
      mobileDeviceStoreDetail = `${mobileDeviceStore.name}: ${errorMessage(error)}`;
      await mobileDeviceFallbackStore.init();
      app.log.error({ error }, "Mobile device store initialization failed; using in-memory fallback.");
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

  function markUserProfileStoreReady(): void {
    userProfileStoreStatus = "ok";
    userProfileStoreDetail = `${userProfileStore.name}: ready`;
  }

  async function ensureUserProfileStoreReady(): Promise<boolean> {
    if (userProfileStoreStatus === "ok") {
      return true;
    }
    if (userProfileStoreRecovery) {
      return userProfileStoreRecovery;
    }

    const recovery = (async () => {
      try {
        await userProfileStore.init();
        markUserProfileStoreReady();
        app.log.info(
          { store: userProfileStore.name },
          "User profile store recovered; using persistent directory again."
        );
        return true;
      } catch (error) {
        markUserProfileStoreDegraded(error);
        return false;
      }
    })();
    userProfileStoreRecovery = recovery;
    try {
      return await recovery;
    } finally {
      userProfileStoreRecovery = undefined;
    }
  }

  function userProfileStoreDependencyDetail(): string {
    const diagnostics = userProfileStore.diagnostics?.();
    return diagnostics ? `${userProfileStoreDetail}; ${diagnostics}` : userProfileStoreDetail;
  }

  function markMobileDeviceStoreDegraded(error: unknown): void {
    mobileDeviceStoreStatus = "degraded";
    mobileDeviceStoreDetail = `${mobileDeviceStore.name}: ${errorMessage(error)}`;
    app.log.error({ error }, "Mobile device store failed; using in-memory fallback.");
  }

  function mobileDeviceStoreDependencyDetail(): string {
    const diagnostics = mobileDeviceStore.diagnostics?.();
    return diagnostics ? `${mobileDeviceStoreDetail}; ${diagnostics}` : mobileDeviceStoreDetail;
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

  function streamBusDependencyDetail(): string {
    return streamBus.diagnostics() || streamBusDetail;
  }

  function streamBusDependencyStatus(): DependencyStatus {
    return streamBus.metrics.ready || streamBus.name === "memory" ? "ok" : streamBusStatus;
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

  function activeMobileDeviceStore(): MobileDeviceStore {
    return mobileDeviceStoreStatus === "ok" ? mobileDeviceStore : mobileDeviceFallbackStore;
  }

  function activeCommunityReportStore(): CommunityReportStore {
    return communityReportStore && communityReportStoreStatus === "ok"
      ? communityReportStore
      : communityReportFallbackStore;
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
      state.sources.set(
        flightDataSource.sourceSystem.sourceSystemId,
        withFlightDataHealth(activeFlightDataSourceSystem(), result.health)
      );
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
      state.sources.set(
        flightDataSource.sourceSystem.sourceSystemId,
        withFlightDataHealth(activeFlightDataSourceSystem(), health)
      );
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

  function aiContextIndexDependency(): { detail: string; name: string; status: DependencyStatus } {
    const diagnostics = aiContextIndex.diagnostics();
    return {
      detail: [
        `documents ${diagnostics.documentCount}`,
        diagnostics.refreshedAt ? `refreshedAt ${diagnostics.refreshedAt}` : "not refreshed"
      ].join("; "),
      name: "ai-context-index",
      status: diagnostics.status === "disabled" ? "disabled" : diagnostics.status === "ok" ? "ok" : "degraded"
    };
  }

  async function refreshAiContextIndex(reason: string, requestNow: Date): Promise<AiContextIndexRefreshResult> {
    if (aiContextIndexRefreshInFlight) {
      return aiContextIndexRefreshInFlight;
    }
    aiContextIndexRefreshInFlight = (async () => {
      const documents = createSemanticDocuments(await buildAiContextIndexSnapshot(requestNow));
      const result = aiContextIndex.replaceDocuments(documents, {
        indexedAt: requestNow,
        reason
      });
      if (reason !== "background") {
        appendAudit(state, "AI_CONTEXT_INDEX_REFRESHED", {
          documentCount: result.documentCount,
          reason,
          status: result.status
        });
      }
      return result;
    })();
    try {
      return await aiContextIndexRefreshInFlight;
    } finally {
      aiContextIndexRefreshInFlight = undefined;
    }
  }

  async function buildAiContextIndexSnapshot(requestNow: Date): Promise<{
    alerts: Record<string, unknown>[];
    communityReports: Record<string, unknown>[];
    incidents: Record<string, unknown>[];
    mapFeatures: Record<string, unknown>[];
    objects: Record<string, unknown>[];
    sourceHealth: Record<string, unknown>[];
  }> {
    const subject = defaultSystemSubject();
    const simSearchMapFeatures = await readSimSearchMapFeaturesForAiIndex(requestNow);
    const sourceHealth = buildSourceHealthItems(state, requestNow, trackLifecycle);
    const readableObjects = prioritizeObjectsForAi(
      selectCurrentTracks(state.objects.values(), requestNow, trackLifecycle).filter((object) =>
        canReadObject(subject, object)
      )
    ).slice(0, aiContextIndexObjectLimit);
    const decoratedObjects = await decorateObjectsWithConflictEvidence(readableObjects, requestNow);
    const alerts = buildCopAlerts({
      acknowledgements: new Map(),
      aoiRules: [],
      evaluatedAt: requestNow.toISOString(),
      objects: decoratedObjects,
      sourceHealth
    })
      .filter((alert) => alert.status === "ACTIVE")
      .slice(0, 80);
    const communityReports = (
      await listCommunityReports({
        limit: aiContextIndexCommunityReportLimit,
        statuses: ["submitted", "published"]
      })
    )
      .filter((report) => report.visibility !== "private")
      .slice(0, aiContextIndexCommunityReportLimit);
    const incidents = (
      await listIncidents({
        limit: aiContextIndexIncidentLimit,
        statuses: ["active", "candidate", "monitoring"]
      })
    ).slice(0, aiContextIndexIncidentLimit);
    return {
      alerts: alerts.map(summarizeAlertForAi),
      communityReports: communityReports.map(summarizeCommunityReportForAi),
      incidents: incidents.map(summarizeIncidentForAi),
      mapFeatures: simSearchMapFeatures,
      objects: decoratedObjects.map(summarizeObjectForAi),
      sourceHealth: sourceHealth.map(summarizeSourceHealthForAi)
    };
  }

  async function readSimSearchMapFeaturesForAiIndex(requestNow: Date): Promise<Record<string, unknown>[]> {
    if (!simSearchDataSource?.fetchEntities || aiContextIndexSimSearchEntityLimit <= 0) {
      return [];
    }
    const responses: SimSearchEntitiesResponse[] = [];
    let cursor: string | undefined;
    let remaining = aiContextIndexSimSearchEntityLimit;
    try {
      for (let page = 0; page < 8 && remaining > 0; page += 1) {
        const response = await simSearchDataSource.fetchEntities(
          {
            ...(cursor ? { cursor } : {}),
            limit: Math.min(remaining, simSearchDataSource.config.indexLimit || remaining)
          },
          requestNow
        );
        responses.push(response);
        remaining -= response.results.length;
        cursor = response.nextCursor;
        if (!cursor || response.results.length === 0) {
          break;
        }
      }
      const combined: SimSearchEntitiesResponse = {
        contractVersion: "sim-search-source-v1",
        generatedAt: requestNow.toISOString(),
        providerId: responses[0]?.providerId ?? "sim.search-data",
        query: {
          limit: aiContextIndexSimSearchEntityLimit
        },
        results: responses.flatMap((response) => response.results),
        summary: {
          resultCount: responses.reduce((sum, response) => sum + response.results.length, 0),
          staleResultCount: responses.reduce((sum, response) => sum + response.summary.staleResultCount, 0),
          warningCount: responses.reduce((sum, response) => sum + response.warnings.length, 0)
        },
        warnings: Array.from(new Set(responses.flatMap((response) => response.warnings)))
      };
      const health = buildSimSearchDataHealth(combined, requestNow);
      state.sources.set(
        simSearchDataSource.sourceSystem.sourceSystemId,
        withSimSearchDataHealth(activeSimSearchDataSourceSystem(), health)
      );
      return summarizeSimSearchResponseForAi(combined, undefined);
    } catch (error) {
      const health = unavailableSimSearchDataHealth(error, requestNow);
      state.sources.set(
        simSearchDataSource.sourceSystem.sourceSystemId,
        withSimSearchDataHealth(activeSimSearchDataSourceSystem(), health)
      );
      app.log.warn({ error }, "AI context index SIM search-data entity refresh failed.");
      return [];
    }
  }

  async function queryAiContextIndexForAi(input: {
    actor: AuthenticatedActor;
    body: Record<string, unknown>;
    correlationId: string;
    geoQuery?: string;
    query: string;
    retrievalIntent?: AiRetrievalIntent;
    requestId: string;
    requestNow: Date;
  }): Promise<AiIndexedContext> {
    if (aiContextIndex.shouldRefresh(input.requestNow, aiContextIndexMaxAgeMs)) {
      try {
        await refreshAiContextIndex("lazy-query", input.requestNow);
      } catch (error) {
        appendAudit(
          state,
          "AI_CONTEXT_INDEX_REFRESH_FAILED",
          {
            actorSubjectId: input.actor.subjectId,
            error: errorMessage(error),
            requestId: input.requestId
          },
          input.correlationId
        );
        app.log.warn({ error }, "AI context index lazy refresh failed.");
      }
    }
    const geo = await resolveAiContextGeoFilter(input.body, input.geoQuery ?? input.query, input.requestNow);
    const timeWindow = resolveAiContextTimeWindow(input.body);
    const indexedContext = await aiContextIndex.query(aiSemanticRetriever, {
      generatedAt: input.requestNow,
      ...(geo ? { geo } : {}),
      limit: aiContextIndexQueryLimit,
      query: input.query,
      ...(input.retrievalIntent ? { retrievalIntent: input.retrievalIntent } : {}),
      timeWindow
    });
    appendAudit(
      state,
      "AI_CONTEXT_INDEX_TOOL_INVOKED",
      {
        actorSubjectId: input.actor.subjectId,
        candidateDocumentCount: indexedContext.toolCall.candidateDocumentCount,
        geo: indexedContext.query.geo,
        invocationId: indexedContext.toolCall.invocationId,
        matchedDocumentCount: indexedContext.toolCall.matchedDocumentCount,
        requestId: input.requestId,
        retrievalIntent: input.retrievalIntent,
        status: indexedContext.toolCall.status,
        timeWindow: indexedContext.query.timeWindow,
        toolId: indexedContext.toolCall.toolId,
        warnings: indexedContext.toolCall.warnings
      },
      input.correlationId
    );
    return indexedContext;
  }

  async function retrieveAiSemanticContext(input: {
    documents: AiSemanticDocument[];
    generatedAt: Date;
    limit?: number;
    query: string;
    retrievalIntent?: AiRetrievalIntent;
  }): Promise<AiSemanticContext> {
    return withTimeoutFallback(
      aiSemanticRetriever.retrieve(input),
      aiSemanticRetrievalTimeoutMs,
      () => emptyAiSemanticContext(input, `Semantic retrieval timed out after ${aiSemanticRetrievalTimeoutMs} ms.`),
      "AI semantic retrieval completed after the request timeout."
    );
  }

  async function queryCopAssistantForAi(
    aiRequest: AiCopQuery,
    requestNow: Date,
    operation: "chat-agent" | "situation-summary"
  ): Promise<AiCopResponse> {
    try {
      return await withTimeoutFallback(
        aiGateway.queryCopAssistant(aiRequest),
        aiGatewayRequestTimeoutMs,
        () =>
          aiGatewayFallbackResponse(
            aiRequest,
            requestNow,
            operation,
            `AI provider timed out after ${aiGatewayRequestTimeoutMs} ms.`
          ),
        "AI provider returned after the COP request timeout."
      );
    } catch (error) {
      return aiGatewayFallbackResponse(aiRequest, requestNow, operation, `AI provider failed: ${errorMessage(error)}`);
    }
  }

  function withTimeoutFallback<T>(
    promise: Promise<T>,
    timeoutMs: number,
    fallback: () => T,
    lateCompletionMessage: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(fallback());
      }, timeoutMs);
      promise
        .then((value) => {
          if (settled) {
            app.log.warn({ timeoutMs }, lateCompletionMessage);
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        })
        .catch((error: unknown) => {
          if (settled) {
            app.log.warn({ error, timeoutMs }, lateCompletionMessage);
            return;
          }
          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  function emptyAiSemanticContext(
    input: { generatedAt: Date; query: string; retrievalIntent?: AiRetrievalIntent },
    warning: string
  ): AiSemanticContext {
    return {
      citations: [],
      contractVersion: "cop-ai-semantic-context-v1",
      generatedAt: input.generatedAt.toISOString(),
      includedDocumentCount: 0,
      items: [],
      query: input.query.trim(),
      ...(input.retrievalIntent ? { retrievalIntent: input.retrievalIntent } : {}),
      status: "degraded",
      warnings: [warning]
    };
  }

  function pruneAiChatAgentJobs(requestNow = now()): void {
    const timestamp = requestNow.getTime();
    for (const [jobId, job] of aiChatAgentJobs) {
      if (Date.parse(job.expiresAt) <= timestamp) {
        aiChatAgentJobs.delete(jobId);
      }
    }
  }

  function aiChatAgentJobPayload(job: AiChatAgentJobRecord): Record<string, unknown> {
    return compactRecord({
      contractVersion: "cop-ai-chat-agent-job-v1",
      createdAt: job.createdAt,
      error: job.error,
      expiresAt: job.expiresAt,
      jobId: job.jobId,
      requestId: job.requestId,
      response: job.response,
      status: job.status,
      updatedAt: job.updatedAt
    });
  }

  function updateAiChatAgentJob(
    jobId: string,
    update: Partial<AiChatAgentJobRecord>,
    requestNow = now()
  ): AiChatAgentJobRecord | undefined {
    const current = aiChatAgentJobs.get(jobId);
    if (!current) {
      return undefined;
    }
    const next = {
      ...current,
      ...update,
      updatedAt: requestNow.toISOString()
    };
    aiChatAgentJobs.set(jobId, next);
    return next;
  }

  function startAiChatAgentJob(input: {
    authorization: string;
    body: Record<string, unknown>;
    correlationId: string;
    jobId: string;
  }): void {
    setImmediate(() => {
      void runAiChatAgentJob(input);
    });
  }

  async function runAiChatAgentJob(input: {
    authorization: string;
    body: Record<string, unknown>;
    correlationId: string;
    jobId: string;
  }): Promise<void> {
    updateAiChatAgentJob(input.jobId, { status: "running" });
    try {
      const response = await app.inject({
        headers: {
          authorization: input.authorization,
          "x-correlation-id": input.correlationId
        },
        method: "POST",
        payload: input.body,
        url: "/api/v1/ai/chat-agent/query"
      });
      const parsed = response.json() as Record<string, unknown>;
      if (response.statusCode >= 200 && response.statusCode < 300) {
        const aiResponse = parsed as unknown as AiCopResponse;
        updateAiChatAgentJob(input.jobId, {
          requestId: aiResponse.requestId,
          response: aiResponse,
          status: "completed"
        });
        return;
      }
      updateAiChatAgentJob(input.jobId, {
        error: {
          message: errorMessageFromResponse(parsed) ?? `AI chat agent job failed with HTTP ${response.statusCode}.`,
          statusCode: response.statusCode
        },
        status: "failed"
      });
    } catch (error) {
      updateAiChatAgentJob(input.jobId, {
        error: {
          message: errorMessage(error)
        },
        status: "failed"
      });
    }
  }

  function limitAiSemanticDocuments(
    documents: AiSemanticDocument[],
    limit: number,
    retrievalIntent: AiRetrievalIntent
  ): AiSemanticDocument[] {
    const max = Math.max(1, Math.trunc(limit));
    if (documents.length <= max) {
      return prioritizeAiSemanticDocuments(documents, retrievalIntent);
    }
    return prioritizeAiSemanticDocuments(documents, retrievalIntent).slice(0, max);
  }

  function prioritizeAiSemanticDocuments(
    documents: AiSemanticDocument[],
    retrievalIntent: AiRetrievalIntent
  ): AiSemanticDocument[] {
    return documents
      .map((document, index) => ({
        document,
        index,
        score: aiSemanticDocumentCandidateScore(document, retrievalIntent)
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((item) => item.document);
  }

  function aiSemanticDocumentCandidateScore(document: AiSemanticDocument, retrievalIntent: AiRetrievalIntent): number {
    const text = `${document.entityType} ${document.title ?? ""} ${document.text}`.toLocaleLowerCase("cs-CZ");
    let score = 0;
    switch (document.entityType) {
      case "incident":
        score += 1;
        break;
      case "communityReport":
        score += 0.92;
        break;
      case "alert":
        score += 0.86;
        break;
      case "chatMessage":
        score += 0.78;
        break;
      case "sourceHealth":
        score += 0.45;
        break;
      case "observedObject":
        score += 0.28;
        break;
    }
    if (
      /(povod|flood|voda|water|řek|rek|hladin|fire|požár|pozar|kouř|kour|medical|zdravot|infrastruktur|bridge|most|traffic|doprav|polic|police|security|bezpeč|bezpec|incident|evaku|hazard|rizik)/u.test(
        text
      )
    ) {
      score += 0.45;
    }
    if (/(critical|kritick|warning|výstrah|vystrah|active|aktiv|submitted|published|monitoring)/u.test(text)) {
      score += 0.16;
    }
    if (
      retrievalIntent.categories.includes("flood-water") &&
      /(povod|flood|voda|water|řek|rek|hladin|hydro)/u.test(text)
    ) {
      score += 0.24;
    }
    if (retrievalIntent.categories.includes("fire") && /(fire|požár|pozar|kouř|kour|hotspot|firms)/u.test(text)) {
      score += 0.22;
    }
    if (
      retrievalIntent.categories.includes("security-police") &&
      /(polic|security|bezpeč|bezpec|kráde|krade|zlod|crime)/u.test(text)
    ) {
      score += 0.2;
    }
    if (aiIntentSuppressesRoutineCivilAir(retrievalIntent) && isRoutineCivilAirText(text)) {
      score -= 0.55;
    } else if (/(air|flight|letadl|track_stale|stale|zastaral|low_confidence)/u.test(text)) {
      score -= 0.22;
    }
    return score;
  }

  function aiGatewayFallbackResponse(
    aiRequest: AiCopQuery,
    requestNow: Date,
    operation: "chat-agent" | "situation-summary",
    reason: string
  ): AiCopResponse {
    const mapSearchFallback =
      operation === "chat-agent" ? aiMapSearchFallbackResponse(aiRequest, requestNow, reason) : undefined;
    if (mapSearchFallback) {
      return mapSearchFallback;
    }
    return {
      auditId: randomUUID(),
      model: "timeout-fallback",
      policy: {
        allowed: true,
        reason,
        redactionsApplied: false
      },
      provider: "local",
      requestId: aiRequest.requestId,
      result: {
        structured: {
          error: {
            operation,
            reason,
            timeoutMs: aiGatewayRequestTimeoutMs,
            type: "ai-provider-timeout"
          },
          generatedAt: requestNow.toISOString()
        },
        summary: [
          "AI odpověď se nepodařilo dokončit v časovém limitu.",
          "COP kontext a zdroje byly připravené, ale model nevrátil použitelný výsledek včas.",
          "Zkuste dotaz zúžit, použít `/fast`, nebo požadavek spustit znovu."
        ].join(" ")
      },
      status: "NEEDS_HUMAN_REVIEW"
    };
  }

  async function resolveAiContextGeoFilter(
    body: Record<string, unknown>,
    query: string,
    requestNow: Date
  ): Promise<AiContextGeoFilter | undefined> {
    const explicitGeo = parseAiContextGeoFilter(body);
    if (explicitGeo) {
      return explicitGeo;
    }
    const usesImplicitCurrentArea = aiQuestionUsesImplicitCurrentArea(query);
    const placeQuery =
      aiContextPlaceFromBody(body) ??
      (usesImplicitCurrentArea ? undefined : aiPlaceQueryFromQuestion(query)) ??
      inferAiMapSearchIntent(query, body).placeQuery;
    if (!placeQuery || !placeGeocoder) {
      return undefined;
    }
    try {
      let place: PlaceGeocodeResult | undefined;
      for (const candidate of aiPlaceGeocoderQueryCandidates(placeQuery)) {
        const response = await placeGeocoder.search(
          {
            language: aiLanguage(body.language),
            limit: 1,
            query: candidate
          },
          requestNow
        );
        place = response.items[0];
        if (place) {
          break;
        }
      }
      if (!place) {
        return undefined;
      }
      const [lon, lat] = place.center;
      return {
        ...(place.bbox ? { bbox: place.bbox } : {}),
        center: {
          lat,
          lon,
          radiusKm: aiContextIndexDefaultRadiusKm
        },
        label: place.displayName,
        source: "geocoder"
      };
    } catch (error) {
      app.log.warn({ error, placeQuery }, "AI context geocode lookup failed.");
      return undefined;
    }
  }

  function aiPlaceGeocoderQueryCandidates(placeQuery: string): string[] {
    const normalized = placeQuery.replace(/\s+/gu, " ").trim();
    const candidates = new Set<string>([normalized]);
    const parts = normalized.split(" ");
    const first = parts[0];
    if (first) {
      const rest = parts.slice(1).join(" ");
      const addFirstVariant = (value: string) => {
        candidates.add([value, rest].filter(Boolean).join(" "));
      };
      if (/ně$/iu.test(first)) {
        addFirstVariant(first.replace(/ně$/iu, "no"));
      }
      if (/vě$/iu.test(first)) {
        addFirstVariant(first.replace(/vě$/iu, "va"));
      }
      if (/ze$/iu.test(first)) {
        addFirstVariant(first.replace(/ze$/iu, "ha"));
      }
      if (/ě$/iu.test(first)) {
        addFirstVariant(first.replace(/ě$/iu, "a"));
      }
    }
    return Array.from(candidates)
      .filter((candidate) => candidate.length >= 3)
      .slice(0, 4);
  }

  function shouldAnswerAiChatAgentWithMapSearchResult(
    question: string,
    body: Record<string, unknown>,
    mapSearch: AiMapSearchContext | undefined
  ): boolean {
    if (!mapSearch || mapSearch.results.length === 0) {
      return false;
    }
    if (isGeneralWeatherForecastQuestion(question)) {
      return false;
    }
    const intent = inferAiMapSearchIntent(question, body);
    return intent.requested || intent.layerIds.length > 0 || intent.categoryIds.length > 0;
  }

  function isGeneralWeatherForecastQuestion(question: string): boolean {
    const playbook = aiResponsePlaybookGuidanceForQuestion(question);
    return optionalText(playbook?.intentId) === "weather.summary.forecast";
  }

  function shouldClarifyAiWeatherLocation(
    question: string,
    mapSearch: AiMapSearchContext | undefined
  ): boolean {
    if (!isGeneralWeatherForecastQuestion(question)) {
      return false;
    }
    const query = isRecord(mapSearch?.query) ? mapSearch.query : {};
    return !isRecord(query.center) && !isRecord(query.bbox) && !optionalText(query.placeQuery);
  }

  function aiWeatherLocationClarificationResponse(
    aiRequest: AiCopQuery,
    requestNow: Date
  ): AiCopResponse {
    return {
      auditId: randomUUID(),
      model: "weather-location-clarification",
      policy: {
        allowed: true,
        reason: "A location is required before retrieving a weather forecast.",
        redactionsApplied: false
      },
      provider: "local",
      requestId: aiRequest.requestId,
      result: {
        structured: {
          clarification: {
            field: "location",
            suggestedActions: ["use-current-location", "enter-place"]
          },
          generatedAt: requestNow.toISOString()
        },
        summary: "Pro jaké místo chcete předpověď? Napište obec nebo oblast; pokud má COP povolenou polohu, můžete použít aktuální polohu zařízení."
      },
      status: "COMPLETED"
    };
  }

  function parseAiContextGeoFilter(body: Record<string, unknown>): AiContextGeoFilter | undefined {
    const geoContext = isRecord(body.geoContext) ? body.geoContext : {};
    const bbox = parseMapQueryBbox(geoContext.bbox ?? body.bbox);
    const location = firstRecord(geoContext.currentLocation, geoContext.location, body.currentLocation, body.location);
    const lat = location ? optionalFiniteNumber(location.lat ?? location.latitude, -90, 90) : undefined;
    const lon = location
      ? optionalFiniteNumber(location.lon ?? location.lng ?? location.longitude, -180, 180)
      : undefined;
    const radiusKm = location
      ? (optionalFiniteNumber(location.radiusKm ?? location.radius ?? geoContext.radiusKm ?? body.radiusKm, 0.1, 500) ??
        aiContextIndexDefaultRadiusKm)
      : undefined;
    if (!bbox && (lat === undefined || lon === undefined || radiusKm === undefined)) {
      return undefined;
    }
    return {
      ...(bbox ? { bbox } : {}),
      ...(lat !== undefined && lon !== undefined && radiusKm !== undefined ? { center: { lat, lon, radiusKm } } : {}),
      ...(optionalText(geoContext.label ?? location?.label ?? body.locationLabel)
        ? { label: optionalText(geoContext.label ?? location?.label ?? body.locationLabel) }
        : {}),
      source: "body"
    };
  }

  function resolveAiContextTimeWindow(body: Record<string, unknown>): AiContextTimeWindow {
    const timeWindow = isRecord(body.timeWindow) ? body.timeWindow : {};
    const from = optionalIsoString(timeWindow.from ?? timeWindow.since ?? body.from ?? body.since);
    const to = optionalIsoString(timeWindow.to ?? body.to);
    const maxAgeSeconds = readBoundedInteger(
      timeWindow.maxAgeSeconds ?? body.maxAgeSeconds ?? body.lookbackSeconds,
      aiContextIndexLookbackSeconds,
      60,
      30 * 24 * 3600
    );
    return compactRecord({
      from,
      maxAgeSeconds,
      to
    }) as AiContextTimeWindow;
  }

  function aiContextPlaceFromBody(body: Record<string, unknown>): string | undefined {
    const geoContext = isRecord(body.geoContext) ? body.geoContext : {};
    return optionalTrimmedString(geoContext.place ?? geoContext.query ?? body.placeQuery ?? body.place, 120);
  }

  async function resolveAiMapSearchContextForChatAgent(input: {
    actor: AuthenticatedActor;
    body: Record<string, unknown>;
    question: string;
    requestId: string;
    requestNow: Date;
  }): Promise<AiMapSearchContext | undefined> {
    const intent = inferAiMapSearchIntent(input.question, input.body);
    if (!intent.requested && intent.layerIds.length === 0 && !intent.placeQuery) {
      return undefined;
    }

    const warnings: string[] = [];
    const invocationId = randomUUID();
    const geoFilter = await resolveAiContextGeoFilter(input.body, input.question, input.requestNow);
    const bbox = bboxForAiMapSearchGeoFilter(geoFilter);
    const mapResults: AiMapSearchResult[] = [];

    if (simSearchDataSource && (intent.requested || intent.placeQuery || intent.searchTerms.length > 0)) {
      const entityTypes = simSearchEntityTypesForAiMapSearchIntent(intent);
      const sourceSystems = simSearchSourceSystemsForAiMapSearchIntent(intent);
      const query = compactRecord({
        ...(bbox ? { bbox } : {}),
        ...(geoFilter?.center
          ? {
              center: {
                lat: geoFilter.center.lat,
                lon: geoFilter.center.lon
              },
              radiusM: Math.round(clampNumber(geoFilter.center.radiusKm ?? 30, 1, 250) * 1000)
            }
          : {}),
        ...(entityTypes ? { entityTypes } : {}),
        ...(sourceSystems ? { sourceSystems } : {}),
        includeStale: false,
        limit: 24,
        text: input.question,
        validAt: input.requestNow.toISOString()
      });
      try {
        const response = await simSearchDataSource.query(query, input.requestNow);
        const health = buildSimSearchDataHealth(response, input.requestNow);
        state.sources.set(
          simSearchDataSource.sourceSystem.sourceSystemId,
          withSimSearchDataHealth(activeSimSearchDataSourceSystem(), health)
        );
        warnings.push(...response.warnings);
        const simResults = summarizeSimSearchResponseForAi(response, geoFilter);
        mapResults.push(...simResults);
        appendAudit(state, "AI_SIM_SEARCH_DATA_TOOL_INVOKED", {
          entityTypes,
          matchedFeatureCount: simResults.length,
          providerId: response.providerId,
          requestId: input.requestId,
          sourceSystems,
          sourceSystemId: simSearchDataSource.sourceSystem.sourceSystemId,
          status: simResults.length > 0 ? "ok" : "empty",
          warnings: response.warnings
        });
      } catch (error) {
        const health = unavailableSimSearchDataHealth(error, input.requestNow);
        state.sources.set(
          simSearchDataSource.sourceSystem.sourceSystemId,
          withSimSearchDataHealth(activeSimSearchDataSourceSystem(), health)
        );
        app.log.warn({ error, requestId: input.requestId }, "AI SIM search-data lookup failed.");
        warnings.push(`SIM search-data vyhledávání selhalo: ${errorMessage(error)}`);
        appendAudit(state, "AI_SIM_SEARCH_DATA_TOOL_FAILED", {
          error: errorMessage(error),
          requestId: input.requestId,
          sourceSystemId: simSearchDataSource.sourceSystem.sourceSystemId
        });
      }
    }

    if (intent.requested || intent.layerIds.length > 0) {
      if (!bbox) {
        warnings.push("Mapové vyhledávání potřebuje aktuální polohu, bbox nebo místo v dotazu.");
      } else {
        try {
          const providers = await readMapCatalogProviders(input.requestNow, input.actor, false);
          const catalog = buildMapCatalog({
            flight: providers.flight,
            generatedAt: input.requestNow,
            includeDiagnostics: false,
            includePartner: false,
            locale: aiLanguage(input.body.language),
            missionArena: providers.missionArena,
            safety: providers.safety,
            situation: providers.situation,
            tak: providers.tak
          });
          const queryableLayers = catalog.layers.filter(
            (layer) => catalogLayerAvailableForMapQuery(layer) && catalogLayerQueryableForFeatureQuery(layer)
          );
          const catalogMatchedLayers = queryableLayers.filter((layer) =>
            aiMapCatalogLayerMatchesMapSearchIntent(layer, intent)
          );
          const selectedLayers =
            intent.layerIds.length > 0
              ? queryableLayers.filter((layer) => intent.layerIds.includes(layer.layerId))
              : catalogMatchedLayers.length > 0
                ? catalogMatchedLayers
                : queryableLayers;
          const unknownLayerIds =
            intent.layerIds.length > 0
              ? intent.layerIds.filter((layerId) => !catalog.layers.some((layer) => layer.layerId === layerId))
              : [];
          const unavailableLayerIds =
            intent.layerIds.length > 0
              ? intent.layerIds.filter((layerId) =>
                  catalog.layers.some((layer) => layer.layerId === layerId && !catalogLayerAvailableForMapQuery(layer))
                )
              : [];
          if (selectedLayers.length === 0) {
            warnings.push("Pro dotaz nebyla k dispozici žádná použitelná mapová vrstva.");
          }
          if (intent.layerIds.length === 0 && catalogMatchedLayers.length === 0 && queryableLayers.length > 0) {
            warnings.push(
              "Dotaz nebyl navázán na konkrétní katalogovou vrstvu; prohledány dostupné mapové vrstvy v zadaném okolí."
            );
          }
          if (unknownLayerIds.length > 0) {
            warnings.push(`Neznámé mapové vrstvy ignorovány: ${unknownLayerIds.join(", ")}.`);
          }
          if (unavailableLayerIds.length > 0) {
            warnings.push(`Nedostupné mapové vrstvy ignorovány: ${unavailableLayerIds.join(", ")}.`);
          }
          const query: MapFeatureQueryRequest = {
            bbox,
            filters: {},
            includeDiagnostics: false,
            includePartner: false,
            layerIds: selectedLayers.map((layer) => layer.layerId),
            limit: 120
          };
          const providerQueries = buildProviderFeatureQueries(selectedLayers, query);
          const [
            situationCollection,
            safetyCollection,
            flightCollection,
            communityCollection,
            missionArenaCollection,
            takCollection
          ] = await Promise.all([
            readSituationMapQuery(providerQueries.situation, input.requestNow, input.actor, selectedLayers),
            readSafetyMapQuery(providerQueries.safety, input.requestNow),
            readFlightReferenceMapQuery(providerQueries.flight, input.requestNow),
            readCommunityMapQuery(providerQueries.community, input.requestNow, input.actor),
            readMissionArenaMapQuery(providerQueries.missionArena, input.requestNow),
            readTakMapQuery(providerQueries.tak, input.requestNow)
          ]);
          warnings.push(...mapFeatureCollectionWarnings(situationCollection));
          warnings.push(...mapFeatureCollectionWarnings(safetyCollection));
          warnings.push(...mapFeatureCollectionWarnings(flightCollection));
          warnings.push(...mapFeatureCollectionWarnings(communityCollection));
          warnings.push(...mapFeatureCollectionWarnings(missionArenaCollection));
          warnings.push(...mapFeatureCollectionWarnings(takCollection));
          mapResults.push(
            ...(situationCollection?.features ?? [])
              .filter((feature) => aiSituationFeatureMatchesMapSearchIntent(feature, intent))
              .map((feature) => summarizeSituationMapFeatureForAi(feature, geoFilter))
          );
          mapResults.push(
            ...summarizeMapFeatureCollectionForAi(safetyCollection, geoFilter, intent, "sim.safety-data")
          );
          mapResults.push(
            ...summarizeMapFeatureCollectionForAi(flightCollection, geoFilter, intent, "sim.flight-data")
          );
          mapResults.push(
            ...summarizeMapFeatureCollectionForAi(communityCollection, geoFilter, intent, "cop.community")
          );
          mapResults.push(
            ...summarizeMapFeatureCollectionForAi(missionArenaCollection, geoFilter, intent, "csm.mission-arena")
          );
          mapResults.push(...summarizeMapFeatureCollectionForAi(takCollection, geoFilter, intent, "sim.tak-gateway"));
        } catch (error) {
          app.log.warn({ error, requestId: input.requestId }, "AI map search failed.");
          warnings.push(`Mapové vyhledávání selhalo: ${errorMessage(error)}`);
        }
      }
    }

    if (
      mapResults.length === 0 &&
      placeGeocoder &&
      bbox &&
      (intent.categoryIds.length > 0 || intent.searchTerms.length > 0)
    ) {
      const fallbackQueries = aiMapGeocoderFallbackQueries(intent);
      for (const fallbackQuery of fallbackQueries) {
        try {
          const placeResponse = await placeGeocoder.search(
            {
              bbox,
              bounded: true,
              language: aiLanguage(input.body.language),
              limit: 8,
              query: fallbackQuery
            },
            input.requestNow
          );
          warnings.push(...placeResponse.warnings);
          const placeResults = placeResponse.items
            .filter((place) => aiGeocodedPlaceMatchesMapSearchIntent(place, intent))
            .map((place) => {
              const summary = summarizeGeocodedPlaceForAi(place, geoFilter);
              return compactRecord({
                ...summary,
                ...(intent.categoryIds[0] ? { category: intent.categoryIds[0] } : {}),
                sourceName: `${place.providerId} bounded search`,
                sourceSystemIds: ["geocoder", place.providerId],
                status: "map-result"
              });
            });
          if (placeResults.length > 0) {
            mapResults.push(...placeResults);
            appendAudit(state, "AI_GEOCODER_MAP_SEARCH_FALLBACK_INVOKED", {
              bbox,
              categoryIds: intent.categoryIds,
              matchedFeatureCount: placeResults.length,
              query: fallbackQuery,
              requestId: input.requestId,
              status: "ok",
              toolId: "cop.geocoder.search"
            });
            break;
          }
          appendAudit(state, "AI_GEOCODER_MAP_SEARCH_FALLBACK_INVOKED", {
            bbox,
            categoryIds: intent.categoryIds,
            matchedFeatureCount: 0,
            query: fallbackQuery,
            requestId: input.requestId,
            status: "empty",
            toolId: "cop.geocoder.search"
          });
        } catch (error) {
          app.log.warn(
            { error, query: fallbackQuery, requestId: input.requestId },
            "AI geocoder map-search fallback failed."
          );
          warnings.push(`Geocoder fallback selhal: ${errorMessage(error)}`);
          appendAudit(state, "AI_GEOCODER_MAP_SEARCH_FALLBACK_FAILED", {
            error: errorMessage(error),
            query: fallbackQuery,
            requestId: input.requestId,
            toolId: "cop.geocoder.search"
          });
        }
      }
    }

    if (intent.placeQuery && placeGeocoder) {
      try {
        const placeResponse = await placeGeocoder.search(
          {
            language: aiLanguage(input.body.language),
            limit: 3,
            query: intent.placeQuery
          },
          input.requestNow
        );
        warnings.push(...placeResponse.warnings);
        mapResults.push(...placeResponse.items.map((place) => summarizeGeocodedPlaceForAi(place, geoFilter)));
      } catch (error) {
        app.log.warn(
          { error, placeQuery: intent.placeQuery, requestId: input.requestId },
          "AI place map search failed."
        );
        warnings.push(`Geokódování místa selhalo: ${errorMessage(error)}`);
      }
    } else if (intent.placeQuery && !placeGeocoder) {
      warnings.push("Geocoder pro vyhledávání míst je vypnutý.");
    }

    const results = dedupeAiMapSearchResults(mapResults).sort(aiMapSearchResultCompare).slice(0, 12);
    const status = results.length > 0 ? (warnings.length > 0 ? "degraded" : "ok") : "empty";
    const context: AiMapSearchContext = {
      contractVersion: "cop-ai-map-search-v1",
      generatedAt: input.requestNow.toISOString(),
      query: compactRecord({
        bbox,
        categoryIds: intent.categoryIds,
        center: geoFilter?.center,
        geoLabel: geoFilter?.label,
        layerIds: intent.layerIds,
        placeQuery: intent.placeQuery,
        requested: intent.requested,
        searchTerms: intent.searchTerms
      }),
      results,
      toolCall: compactRecord({
        invocationId,
        matchedFeatureCount: results.length,
        mode: "read_only",
        status,
        toolId: "cop.map.query.search",
        warnings
      }),
      warnings
    };
    appendAudit(state, "AI_MAP_SEARCH_TOOL_INVOKED", {
      categoryIds: intent.categoryIds,
      layerIds: intent.layerIds,
      matchedFeatureCount: results.length,
      requestId: input.requestId,
      status,
      toolId: "cop.map.query.search",
      toolInvocationId: invocationId,
      warnings
    });
    return context;
  }

  function shouldAnswerAiChatAgentWithEmptyMapSearchResult(
    question: string,
    body: Record<string, unknown>,
    mapSearch: AiMapSearchContext | undefined
  ): boolean {
    if (!mapSearch || mapSearch.results.length > 0) {
      return false;
    }
    const intent = inferAiMapSearchIntent(question, body);
    const explicitGeoFilter = parseAiContextGeoFilter(body);
    return (
      Boolean(explicitGeoFilter?.bbox || explicitGeoFilter?.center) &&
      (intent.requested || intent.layerIds.length > 0 || intent.categoryIds.length > 0)
    );
  }

  function aiMapGeocoderFallbackQueries(intent: ReturnType<typeof inferAiMapSearchIntent>): string[] {
    const queries = new Set<string>();
    if (intent.categoryIds.includes("police")) {
      queries.add("police");
      queries.add("policie");
      queries.add("Policie ČR");
      queries.add("police station");
    }
    if (intent.categoryIds.includes("fire_station")) {
      queries.add("hasiči");
      queries.add("hasičská stanice");
      queries.add("fire station");
    }
    if (intent.categoryIds.includes("ambulance_station")) {
      queries.add("záchranná služba");
      queries.add("ambulance station");
      queries.add("nemocnice");
    }
    if (intent.categoryIds.includes("shelter")) {
      queries.add("evakuační centrum");
      queries.add("shelter");
    }
    if (intent.categoryIds.includes("defibrillator")) {
      queries.add("AED");
      queries.add("defibrilátor");
    }
    const terms = intent.searchTerms
      .filter((term) => term.length >= 3)
      .slice(0, 4)
      .join(" ");
    if (terms) {
      queries.add(terms);
    }
    return Array.from(queries).slice(0, 6);
  }

  function aiGeocodedPlaceMatchesMapSearchIntent(
    place: PlaceGeocodeResult,
    intent: ReturnType<typeof inferAiMapSearchIntent>
  ): boolean {
    if (intent.categoryIds.length === 0) {
      return true;
    }
    const haystack = [place.displayName, place.subtitle, place.kind]
      .filter(Boolean)
      .join(" ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLocaleLowerCase("cs-CZ");
    return intent.categoryIds.some((categoryId) => {
      switch (categoryId) {
        case "police":
          return haystack.includes("polic") || /\b(security)\b/u.test(haystack);
        case "fire_station":
          return haystack.includes("hasic") || haystack.includes("pozarn") || /\b(fire)\b/u.test(haystack);
        case "ambulance_station":
          return (
            haystack.includes("zachran") ||
            haystack.includes("ambulanc") ||
            haystack.includes("nemocnic") ||
            /\b(hospital|medical)\b/u.test(haystack)
          );
        case "shelter":
          return /\b(kryt|shelter|evakuac|assembly)\b/u.test(haystack);
        case "defibrillator":
          return /\b(aed|defibrilator|defib)\b/u.test(haystack);
        default:
          return haystack.includes(categoryId.replace(/_/gu, " "));
      }
    });
  }

  function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
    return values.find(isRecord);
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

  function routingDependency(): { detail: string; name: string; status: DependencyStatus } {
    if (!routingSource) {
      return { detail: "disabled", name: "sim-routing-source", status: "disabled" };
    }
    return {
      detail: `enabled; ${routingSource.config.baseUrl}`,
      name: "sim-routing-source",
      status: "ok"
    };
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

  function simSearchDataDependency(): { detail: string; name: string; status: DependencyStatus } {
    if (!simSearchDataSource) {
      return { detail: "disabled", name: "sim-search-data-source", status: "disabled" };
    }
    const health = readSimSearchDataHealth(state.sources.get(simSearchDataSource.sourceSystem.sourceSystemId));
    if (!health) {
      return { detail: "idle; waiting for first request", name: "sim-search-data-source", status: "ok" };
    }
    return {
      detail: health.detail ?? health.lastError ?? health.health.toLowerCase(),
      name: "sim-search-data-source",
      status: health.health === "ONLINE" ? "ok" : "degraded"
    };
  }

  function activeSafetyDataSourceSystem(): SourceSystem {
    if (!safetyDataSource) {
      throw new Error("Safety data source is not enabled.");
    }
    return state.sources.get(safetyDataSource.sourceSystem.sourceSystemId) ?? safetyDataSource.sourceSystem;
  }

  function activeSimSearchDataSourceSystem(): SourceSystem {
    if (!simSearchDataSource) {
      throw new Error("SIM search data source is not enabled.");
    }
    return state.sources.get(simSearchDataSource.sourceSystem.sourceSystemId) ?? simSearchDataSource.sourceSystem;
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
    if (!(await ensureUserProfileStoreReady())) {
      return userProfileFallbackStore.getProfile(subjectId);
    }
    try {
      return await userProfileStore.getProfile(subjectId);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      return userProfileFallbackStore.getProfile(subjectId);
    }
  }

  async function searchUserProfiles(query: string, limit = 10): Promise<UserProfileRecord[]> {
    if (!(await ensureUserProfileStoreReady())) {
      return userProfileFallbackStore.searchProfiles(query, limit);
    }
    try {
      return await userProfileStore.searchProfiles(query, limit);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      return userProfileFallbackStore.searchProfiles(query, limit);
    }
  }

  async function upsertUserProfile(
    profile: Omit<UserProfileRecord, "createdAt" | "updatedAt">
  ): Promise<UserProfileRecord> {
    if (!(await ensureUserProfileStoreReady())) {
      return userProfileFallbackStore.upsertProfile(profile);
    }
    try {
      return await userProfileStore.upsertProfile(profile);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      return userProfileFallbackStore.upsertProfile(profile);
    }
  }

  async function readAlertAcknowledgements(actor: AuthenticatedActor): Promise<Map<string, AlertAcknowledgement>> {
    if (!(await ensureUserProfileStoreReady())) {
      return userProfileFallbackStore.getAlertAcknowledgements(actor.subjectId);
    }
    try {
      return await userProfileStore.getAlertAcknowledgements(actor.subjectId);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      return userProfileFallbackStore.getAlertAcknowledgements(actor.subjectId);
    }
  }

  async function acknowledgeAlertForActor(
    actor: AuthenticatedActor,
    acknowledgement: AlertAcknowledgement
  ): Promise<void> {
    if (!(await ensureUserProfileStoreReady())) {
      await userProfileFallbackStore.acknowledgeAlert(actor.subjectId, acknowledgement);
      return;
    }
    try {
      await userProfileStore.acknowledgeAlert(actor.subjectId, acknowledgement);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      await userProfileFallbackStore.acknowledgeAlert(actor.subjectId, acknowledgement);
    }
  }

  async function createCommunityReport(
    input: Parameters<CommunityReportStore["createReport"]>[0],
    requestNow: Date
  ): Promise<CommunityReportRecord> {
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

  async function submitCommunityReport(
    reportId: string,
    actor: AuthenticatedActor,
    requestNow: Date
  ): Promise<CommunityReportRecord | null> {
    try {
      return await activeCommunityReportStore().submitReport(reportId, actor.subjectId, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.submitReport(reportId, actor.subjectId, requestNow);
    }
  }

  async function updateCommunityReport(
    reportId: string,
    actor: AuthenticatedActor,
    input: Parameters<CommunityReportStore["updateReport"]>[2],
    requestNow: Date
  ): Promise<CommunityReportRecord | null> {
    try {
      return await activeCommunityReportStore().updateReport(reportId, actor.subjectId, input, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.updateReport(reportId, actor.subjectId, input, requestNow);
    }
  }

  async function deleteCommunityReport(
    reportId: string,
    actor: AuthenticatedActor,
    requestNow: Date
  ): Promise<boolean> {
    try {
      return await activeCommunityReportStore().deleteReport(reportId, actor.subjectId, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.deleteReport(reportId, actor.subjectId, requestNow);
    }
  }

  async function deleteCommunityReportForDemoScenario(
    reportId: string,
    demoScenarioId: string,
    requestNow: Date
  ): Promise<boolean> {
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

  async function updateCommunityAttachmentMetadata(
    input: Parameters<CommunityReportStore["updateAttachmentMetadata"]>[0]
  ) {
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

  async function enqueueSpatialVideoConversion(
    reportId: string,
    attachment: CommunityReportAttachmentRecord,
    requestNow: Date
  ): Promise<CommunityReportAttachmentRecord> {
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
      app.log.error(
        { error, attachmentId: attachment.attachmentId, reportId },
        "Spatial video conversion enqueue failed."
      );
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

  async function deleteCommunityGroupForDemoScenario(
    groupId: string,
    demoScenarioId: string,
    requestNow: Date
  ): Promise<boolean> {
    try {
      return await activeCommunityReportStore().deleteGroupForDemoScenario(groupId, demoScenarioId, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.deleteGroupForDemoScenario(groupId, demoScenarioId, requestNow);
    }
  }

  async function requestCommunityGroupMembership(groupId: string, actor: AuthenticatedActor, requestNow: Date) {
    try {
      return await activeCommunityReportStore().requestGroupMembership(
        groupId,
        actorToCommunityActor(actor),
        requestNow
      );
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.requestGroupMembership(groupId, actorToCommunityActor(actor), requestNow);
    }
  }

  async function leaveCommunityGroup(
    groupId: string,
    actor: AuthenticatedActor,
    requestNow: Date
  ): Promise<LeaveCommunityGroupResult> {
    let lastManager = false;
    for (const subjectId of actorCommunitySubjectAliases(actor)) {
      const communityActor = {
        ...actorToCommunityActor(actor),
        subjectId
      };
      try {
        const result = await activeCommunityReportStore().leaveGroup(groupId, communityActor, requestNow);
        if (result.status === "left") {
          return result;
        }
        if (result.status === "last_manager") {
          lastManager = true;
        }
      } catch (error) {
        markCommunityReportStoreDegraded(error);
        const result = await communityReportFallbackStore.leaveGroup(groupId, communityActor, requestNow);
        if (result.status === "left") {
          return result;
        }
        if (result.status === "last_manager") {
          lastManager = true;
        }
      }
    }
    return { status: lastManager ? "last_manager" : "not_found" };
  }

  async function removeCommunityGroupMember(
    groupId: string,
    actor: AuthenticatedActor,
    memberSubjectId: string,
    requestNow: Date
  ): Promise<RemoveCommunityGroupMemberResult> {
    let lastManager = false;
    for (const subjectId of actorCommunitySubjectAliases(actor)) {
      const communityActor = {
        ...actorToCommunityActor(actor),
        subjectId
      };
      try {
        const result = await activeCommunityReportStore().removeGroupMember(
          groupId,
          communityActor,
          memberSubjectId,
          requestNow
        );
        if (result.status === "left") {
          return result;
        }
        if (result.status === "last_manager") {
          lastManager = true;
        }
      } catch (error) {
        markCommunityReportStoreDegraded(error);
        const result = await communityReportFallbackStore.removeGroupMember(
          groupId,
          communityActor,
          memberSubjectId,
          requestNow
        );
        if (result.status === "left") {
          return result;
        }
        if (result.status === "last_manager") {
          lastManager = true;
        }
      }
    }
    return { status: lastManager ? "last_manager" : "not_found" };
  }

  async function updateCommunityGroupMetadata(
    input: Parameters<CommunityReportStore["updateGroupMetadata"]>[0],
    requestNow: Date
  ) {
    try {
      return await activeCommunityReportStore().updateGroupMetadata(input, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.updateGroupMetadata(input, requestNow);
    }
  }

  async function provisionAiMatrixBotForGroup(
    group: CommunityGroupRecord,
    actor: AuthenticatedActor,
    requestNow: Date,
    correlationId: string
  ): Promise<CommunityGroupRecord> {
    const config = aiMatrixBotConfig();
    const chat = isRecord(group.metadata.chat) ? group.metadata.chat : {};
    const aiAssistant = isRecord(chat.aiAssistant) ? chat.aiAssistant : {};
    if (aiAssistant.enabled !== true) {
      return group;
    }

    const conversationId = optionalTrimmedString(chat.conversationId, 160);
    const metadataRoomId = normalizeMatrixRoomId(chat.matrixRoomId);
    let roomId = metadataRoomId;
    let matrixUserId: string | undefined;
    let status: AiMatrixBotProvisionStatus = config.enabled ? "pending_conversation" : "bot_disabled";
    const warnings: string[] = [];
    if (!config.enabled) {
      warnings.push("AI Matrix bot is disabled by COP_AI_MATRIX_BOT_ENABLED.");
    } else if (!conversationId) {
      warnings.push(
        "AI Matrix bot consent is stored; Matrix membership will be provisioned after the group is linked to a conversation."
      );
    } else {
      const sync = await messagingProvider.addConversationMembers(actor, requestNow, conversationId, [
        {
          displayName: config.displayName,
          role: "bot",
          userId: config.userId
        }
      ]);
      warnings.push(...sync.warnings);
      if (!sync.conversation) {
        status = "member_sync_failed";
      } else {
        roomId = sync.conversation.matrix?.roomId ?? roomId;
        if (!roomId) {
          status = "pending_room_binding";
          warnings.push(
            "AI Matrix bot is a conversation member; Matrix invite will be sent when the encrypted room is bound."
          );
        } else {
          const bootstrap = await messagingProvider.fetchMatrixBootstrap(
            aiMatrixBotActor(config),
            requestNow,
            config.deviceId
          );
          warnings.push(...bootstrap.warnings);
          matrixUserId = bootstrap.userId;
          if (!aiMatrixBotBootstrapReady(bootstrap)) {
            status = "bot_token_unavailable";
          } else {
            const join = await joinMatrixRoomAsAiBot(bootstrap, roomId, messagingProvider.config.timeoutMs);
            status = join.joined ? "joined" : "bot_join_failed";
            warnings.push(...join.warnings);
          }
        }
      }
    }

    const nextGroup = await updateCommunityGroupMetadata(
      {
        actor: actorToCommunityActor(actor),
        groupId: group.groupId,
        metadata: {
          ...group.metadata,
          chat: {
            ...chat,
            aiAssistant: {
              ...aiAssistant,
              enabled: true,
              label: config.displayName,
              mode: "cop-context",
              matrixBot: compactRecord({
                deviceId: config.deviceId,
                displayName: config.displayName,
                joinedAt: status === "joined" ? requestNow.toISOString() : undefined,
                matrixUserId,
                membership: status === "joined" ? "join" : status === "pending_room_binding" ? "pending_room" : status,
                roomId,
                status,
                updatedAt: requestNow.toISOString(),
                userId: config.userId,
                warnings: Array.from(new Set(warnings.map(sanitizeAiMatrixBotWarning))).slice(0, 6)
              }),
              e2ee: aiMatrixBotE2eeMetadata(status, requestNow),
              updatedAt: requestNow.toISOString(),
              updatedBy: actor.subjectId
            }
          }
        }
      },
      requestNow
    );
    appendAudit(
      state,
      "AI_MATRIX_BOT_PROVISIONED",
      {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        botStatus: status,
        conversationId,
        groupId: group.groupId,
        matrixBotUserId: config.userId,
        roomId
      },
      correlationId
    );
    return nextGroup ?? group;
  }

  async function upsertCommunityGroupMember(
    input: Parameters<CommunityReportStore["upsertGroupMember"]>[0],
    requestNow: Date
  ) {
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
    return new Set(
      groups.flatMap((group) =>
        group.members.some((member) => member.subjectId === actor.subjectId && member.status === "active")
          ? [group.groupId]
          : []
      )
    );
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
        return {
          code: "FORBIDDEN",
          message: "Current user cannot publish a sketch drawing into the selected group.",
          status: 403
        };
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
    const nextGroupId = input.groupId === null ? undefined : (input.groupId ?? current.properties.groupId);
    const nextEventId = input.eventId === null ? undefined : (input.eventId ?? current.properties.eventId);
    return validateSketchDrawingWriteScope(
      {
        ...(nextEventId ? { eventId: nextEventId } : {}),
        ...(nextGroupId ? { groupId: nextGroupId } : {}),
        visibility: nextVisibility
      },
      actor
    );
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

  async function deleteSketchDrawingForDemoScenario(
    drawingId: string,
    demoScenarioId: string,
    actor: AuthenticatedActor,
    requestNow: Date
  ): Promise<boolean> {
    try {
      return await activeSketchDrawingStore().deleteForDemoScenario(
        drawingId,
        demoScenarioId,
        actorToSketchActor(actor),
        requestNow
      );
    } catch (error) {
      markSketchDrawingStoreDegraded(error);
      return sketchDrawingFallbackStore.deleteForDemoScenario(
        drawingId,
        demoScenarioId,
        actorToSketchActor(actor),
        requestNow
      );
    }
  }

  async function listFloodDemoObjects(actor: AuthenticatedActor): Promise<{
    drawings: SketchDrawingFeature[];
    groups: CommunityGroupRecord[];
    reports: CommunityReportRecord[];
  }> {
    const groups = (
      await listCommunityGroups({
        includePublic: true,
        subjectId: actor.subjectId
      })
    ).filter(isFloodDemoGroup);
    const reports = (
      await listCommunityReports({
        bbox: floodDemoBbox,
        includeOwnDrafts: true,
        limit: 500,
        statuses: ["draft", "submitted", "published"],
        subjectId: actor.subjectId
      })
    ).filter(isFloodDemoReport);
    const actorGroupIds = await readCommunityActorGroupIds(actor);
    for (const group of groups) {
      actorGroupIds.add(group.groupId);
    }
    const drawings = (
      await listSketchDrawings({
        allowedGroupIds: Array.from(actorGroupIds),
        bbox: floodDemoBbox,
        limit: 500,
        subjectId: actor.subjectId
      })
    ).filter(isFloodDemoDrawing);
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
        status:
          objects.groups.length > 0 || objects.reports.length > 0 || objects.drawings.length > 0 ? "ready" : "empty",
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
      createdAttachments: 0,
      createdDrawings: 0,
      createdGroups: 0,
      createdReports: 0,
      repairedReports: 0
    };
    if (!group) {
      group = await createCommunityGroup(
        {
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
        },
        requestNow
      );
      operation.createdGroups += 1;
    }
    group = await refreshFloodDemoGroupMetadata(group, actor, requestNow);
    group = await ensureFloodDemoGroupMembers(group, actor, requestNow);

    const reportsByTitle = new Map(before.reports.map((report) => [report.title, report]));
    for (const seed of floodDemoReportSeeds(group.groupId, requestNow)) {
      const existingReport = reportsByTitle.get(seed.title);
      if (existingReport && isFloodDemoReportSeedCurrent(existingReport, seed)) {
        operation.createdAttachments += await ensureFloodDemoReportAttachments(existingReport, seed, actor, requestNow);
        continue;
      }
      if (existingReport) {
        if (await deleteCommunityReportForDemoScenario(existingReport.reportId, floodDemoScenarioId, requestNow)) {
          operation.repairedReports += 1;
        } else {
          app.log.warn(
            { reportId: existingReport.reportId, title: existingReport.title },
            "Demo flood report repair skipped because stale report could not be deleted."
          );
          continue;
        }
      }
      const report = await createCommunityReport(
        {
          category: seed.category,
          createdBy: actorToCommunityActor(actor),
          description: seed.description,
          location: seed.location,
          observedAt: seed.observedAt,
          properties: seed.properties,
          title: seed.title,
          visibility: seed.visibility
        },
        requestNow
      );
      operation.createdAttachments += await ensureFloodDemoReportAttachments(report, seed, actor, requestNow);
      await submitCommunityReport(report.reportId, actor, requestNow);
      operation.createdReports += 1;
    }

    const drawingLabels = new Set(before.drawings.map((drawing) => drawing.properties.label));
    for (const seed of floodDemoDrawingSeeds(group.groupId)) {
      if (drawingLabels.has(seed.label ?? "")) {
        continue;
      }
      await createSketchDrawing(
        {
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
        },
        requestNow
      );
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

  async function ensureFloodDemoReportAttachments(
    report: CommunityReportRecord,
    seed: ReturnType<typeof floodDemoReportSeeds>[number],
    actor: AuthenticatedActor,
    requestNow: Date
  ): Promise<number> {
    const existingFileNames = new Set(
      report.attachments
        .filter((attachment) => attachment.status === "uploaded")
        .map((attachment) => attachment.fileName)
        .filter((value): value is string => Boolean(value))
    );
    let created = 0;
    for (const attachmentSeed of seed.attachments ?? []) {
      if (existingFileNames.has(attachmentSeed.fileName)) {
        continue;
      }
      const attachmentId = crypto.randomUUID();
      const objectKey = `demo-scenarios/${floodDemoScenarioId}/${report.reportId}/${attachmentId}/${attachmentSeed.fileName}`;
      await createCommunityAttachment({
        attachmentId,
        bucket: "demo-inline",
        byteSize: attachmentSeed.byteSize,
        contentType: attachmentSeed.contentType,
        fileName: attachmentSeed.fileName,
        kind: attachmentSeed.kind,
        metadata: {
          access: { audience: "public" },
          demo: true,
          demoContentUrl: attachmentSeed.contentUrl,
          demoPreviewUrl: attachmentSeed.previewUrl,
          demoScenarioId: floodDemoScenarioId,
          previewCaption: attachmentSeed.caption
        },
        objectKey,
        reportId: report.reportId,
        subjectId: actor.subjectId,
        uploadExpiresAt: isoAfter(requestNow, 1)
      });
      await completeCommunityAttachment({
        attachmentId,
        byteSize: attachmentSeed.byteSize,
        checksumSha256: createHash("sha256").update(`${report.reportId}:${attachmentSeed.fileName}`).digest("hex"),
        completedAt: requestNow.toISOString(),
        reportId: report.reportId,
        subjectId: actor.subjectId
      });
      created += 1;
    }
    return created;
  }

  async function refreshFloodDemoGroupMetadata(
    group: CommunityGroupRecord,
    actor: AuthenticatedActor,
    requestNow: Date
  ): Promise<CommunityGroupRecord> {
    const updated = await updateCommunityGroupMetadata(
      {
        actor: actorToCommunityActor(actor),
        groupId: group.groupId,
        metadata: floodDemoGroupMetadata(actor)
      },
      requestNow
    );
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
      const next = await upsertCommunityGroupMember(
        {
          actor: actorToCommunityActor(actor),
          groupId: updated.groupId,
          member: {
            displayName: profile.displayName,
            subjectId: profile.subjectId,
            username: profile.username
          },
          role: "member",
          status: "active"
        },
        requestNow
      );
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

  function takeQueuedCurrentTrackPersistence(
    limit: number
  ): Array<{ event: CanonicalEventEnvelope; object: ObservedObject }> {
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
    const readableObjects = selectCurrentTracks(
      state.objects.values(),
      requestNow,
      trackLifecycle,
      includeExpired
    ).filter((object) => canReadObject(subject, object));
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
    const readableObjects = selectCurrentTracks(
      state.objects.values(),
      requestNow,
      trackLifecycle,
      query.includeExpired
    ).filter((object) => canReadObject(subject, object));
    const decoratedObjects = await decorateObjectsWithConflictEvidence(readableObjects, requestNow, query.historyQuery);
    const objectIds =
      query.historyQuery.objectIds && query.historyQuery.objectIds.length > 0
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
      appendAudit(
        state,
        "NOTIFICATION_DECISION_SKIPPED",
        {
          decisionId: decision.decisionId,
          reason: decision.reason,
          source: decision.notification.source,
          type: decision.notification.type
        },
        correlationId
      );
      return {
        decisionId: decision.decisionId,
        idempotencyKey: decision.idempotencyKey,
        reason: decision.reason,
        status: "skipped",
        warnings: []
      };
    }

    const result = await messagingProvider.sendNotification(
      actor,
      requestNow,
      decision.idempotencyKey,
      decision.notification
    );
    appendAudit(
      state,
      "NOTIFICATION_DISPATCH_REQUESTED",
      {
        decisionId: decision.decisionId,
        idempotencyKey: decision.idempotencyKey,
        notificationId: result.notificationId ?? null,
        providerStatus: result.status,
        source: decision.notification.source,
        type: decision.notification.type
      },
      correlationId
    );
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

    const profile =
      (await readUserProfile(actor)) ??
      (await upsertUserProfile({
        alertPreferences: {},
        displayName: actor.displayName,
        ...(actor.email ? { email: actor.email } : {}),
        preferences: {},
        subjectId: actor.subjectId,
        username: actor.username
      }));
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

  registerMessagingRoutes(app, {
    addConversationMembers: async (request, reply) => {
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
    },
    bindMatrixRoom: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const params = request.params as { conversationId: string };
      const binding = normalizeMatrixRoomBindingRequest(request.body ?? {});
      if (!binding) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Matrix room binding accepts an optional roomId and may not contain message content.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const result = await messagingProvider.bindMatrixRoom(actor, now(), params.conversationId, binding);
      return reply.code(result.conversation ? 200 : 502).send(result);
    },
    bootstrap: async (request, reply) => {
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
    },
    e2eeResetAuth: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const input = normalizeMessagingE2eeResetAuthRequest(request.body);
      if (!input) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Matrix E2EE reset auth accepts only a deviceId and public master, self-signing and user-signing keys.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const result = await messagingProvider.completeE2eeResetAuth(actor, now(), input);
      return reply.code(result.completed ? 200 : 502).send(result);
    },
    wakeVoiceCall: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const wake = normalizeMessagingVoiceCallWakeRequest(request.body);
      if (!wake) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Voice call wake requires action, callId and a canonical Matrix roomId.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const conversationResult = await messagingProvider.fetchConversationByRoomId(actor, now(), wake.roomId);
      const conversation = conversationResult.conversation;
      if (!conversation) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Voice call room is not bound to an accessible conversation.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const conversationMemberUserIds = new Set(
        (conversation.members ?? [])
          .map((member) => member.userId)
          .filter((userId): userId is string => Boolean(userId))
      );
      if (
        wake.participantUserIds?.some((userId) => userId === actor.subjectId || !conversationMemberUserIds.has(userId))
      ) {
        return sendError(
          reply,
          403,
          "FORBIDDEN",
          "Voice call recipients must be active members of the accessible conversation.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const recipientUserIds = wake.participantUserIds?.length
        ? wake.participantUserIds
        : Array.from(conversationMemberUserIds).filter(
            (userId) => wake.action === "ended" || userId !== actor.subjectId
          );
      if (recipientUserIds.length === 0) {
        return sendError(
          reply,
          409,
          "NO_CALL_RECIPIENT",
          "Voice call conversation has no other registered member.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const incoming = wake.action === "invite";
      const requestNow = now();
      const notification = await messagingProvider.sendNotification(
        actor,
        requestNow,
        voiceCallWakeIdempotencyKey(actor.subjectId, wake),
        {
          audience: { userIds: recipientUserIds },
          body: incoming
            ? {
                cs: `${actor.displayName || actor.username} volá`,
                en: `${actor.displayName || actor.username} is calling`
              }
            : { cs: "Hovor byl ukončen.", en: "The call ended." },
          deepLink: `csm://chat/room/${encodeURIComponent(wake.roomId)}`,
          expiresAt: new Date(requestNow.getTime() + 90_000).toISOString(),
          metadata: {
            callId: wake.callId,
            renotify: incoming,
            requireInteraction: incoming,
            roomId: wake.roomId,
            sender: actor.subjectId,
            senderDisplayName: actor.displayName || actor.username,
            tag: `cop-call:${wake.roomId}:${wake.callId}`,
            ttlSeconds: 90
          },
          priority: "high",
          severity: "info",
          source: {
            featureId: "matrix.voice_call",
            layerId: "messaging",
            providerId: "csm.messaging",
            sourceName: "COP Chat"
          },
          title: incoming
            ? { cs: "Příchozí hlasový hovor", en: "Incoming voice call" }
            : { cs: "Hovor ukončen", en: "Call ended" },
          type: incoming ? "chat.voice_call.incoming" : "chat.voice_call.ended"
        }
      );
      return reply.code(notification.status === "online" ? 202 : 502).send(notification);
    },
    conversationDetail: async (request, reply) => {
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
    },
    conversations: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }

      return messagingProvider.fetchConversations(actor, now());
    },
    createConversation: async (request, reply) => {
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
      const requestNow = now();
      const created = await messagingProvider.createConversation(actor, requestNow, conversationRequest);
      if (!created.conversation) {
        return reply.code(502).send(created);
      }
      if (created.conversation.matrix?.roomId) {
        return reply.code(201).send(created);
      }

      const ensured = await messagingProvider.bindMatrixRoom(
        actor,
        requestNow,
        created.conversation.conversationId,
        {}
      );
      const result: MessagingConversationCreateResponse = {
        ...created,
        ...(ensured.conversation ? { conversation: ensured.conversation } : {}),
        status: ensured.status,
        warnings: Array.from(new Set([...created.warnings, ...ensured.warnings]))
      };
      return reply.code(ensured.conversation?.matrix?.roomId ? 201 : 502).send(result);
    },
    deleteWebPushDevice: async (request, reply) => {
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
      return reply.code(result.status === "disabled" ? 503 : 202).send(result);
    },
    matrixPushGateway: async (request, reply) => {
      const result = await messagingProvider.forwardMatrixPushNotification(now(), request.body ?? {});
      if (result.warnings.length > 0) {
        app.log.warn(
          {
            providerStatus: result.status,
            statusCode: result.statusCode,
            warnings: result.warnings
          },
          "Matrix push gateway forward degraded"
        );
      }
      return reply.code(result.ok ? 200 : result.statusCode === 503 ? 503 : 502).send(result.body);
    },
    registerWebPushDevice: async (request, reply) => {
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
      return reply.code(result.status === "disabled" ? 503 : 202).send(result);
    },
    resolveConversation: async (request, reply) => {
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
    },
    resolveMatrixIdentities: async (request, reply) => {
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
    },
    status: async () => messagingProvider.fetchStatus(now()),
    webPushConfig: async () => messagingProvider.fetchWebPushConfig(now())
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
      : await Promise.all(
          decisions.map((decision) => dispatchNotificationDecision(actor, decision, requestNow, correlationId))
        );
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

  registerCommunityGroupRoutes(app, {
    listGroups: async (request, reply) => {
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
    },

    createGroup: async (request, reply) => {
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
      const group = await createCommunityGroup(
        {
          anchorLocation: groupRequest.anchorLocation,
          createdBy: actorToCommunityActor(actor),
          description: groupRequest.description,
          metadata: groupRequest.metadata,
          name: groupRequest.name,
          visibility: groupRequest.visibility
        },
        requestNow
      );
      appendAudit(
        state,
        "COMMUNITY_GROUP_CREATED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          groupId: group.groupId,
          visibility: group.visibility
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return reply.code(201).send(group);
    },

    getGroup: async (request, reply) => {
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
    },

    updateGroupMetadata: async (request, reply) => {
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
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      if (metadataEnablesAiAssistant(metadata) && !aiAssistantConsentGranted(metadata)) {
        return sendError(
          reply,
          400,
          "AI_CHAT_AGENT_CONSENT_REQUIRED",
          "Enabling the AI chat agent requires explicit consent for a visible Matrix bot room member.",
          correlationId
        );
      }
      const requestNow = now();
      const group = await updateCommunityGroupMetadata(
        {
          actor: actorToCommunityActor(actor),
          groupId: params.groupId,
          metadata
        },
        requestNow
      );
      if (!group) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Community group was not found or cannot be updated by current user.",
          correlationId
        );
      }
      const responseGroup = metadataEnablesAiAssistant(metadata)
        ? await provisionAiMatrixBotForGroup(group, actor, requestNow, correlationId)
        : group;
      appendAudit(
        state,
        "COMMUNITY_GROUP_METADATA_UPDATED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          groupId: responseGroup.groupId
        },
        correlationId
      );
      return responseGroup;
    },

    deleteGroup: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const params = request.params as { groupId: string };
      const requestNow = now();
      if (!(await deleteCommunityGroup(params.groupId, actor, requestNow))) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Community group was not found or cannot be managed by current user.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      appendAudit(
        state,
        "COMMUNITY_GROUP_DELETED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          groupId: params.groupId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return reply.code(204).send();
    },

    joinGroup: async (request, reply) => {
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
      appendAudit(
        state,
        "COMMUNITY_GROUP_JOIN_REQUESTED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          groupId: group.groupId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return group;
    },

    leaveGroup: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const params = request.params as { groupId: string };
      const result = await leaveCommunityGroup(params.groupId, actor, now());
      if (result.status === "not_found") {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Community group was not found or current user is not an active member.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      if (result.status === "last_manager") {
        return sendError(
          reply,
          409,
          "COMMUNITY_GROUP_LAST_MANAGER",
          "The last active group owner or admin cannot leave the group.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      appendAudit(
        state,
        "COMMUNITY_GROUP_LEFT",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          groupId: result.group.groupId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return result.group;
    },

    removeGroupMember: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const params = request.params as { groupId: string; subjectId: string };
      const memberSubjectId = optionalTrimmedString(params.subjectId, 160);
      if (!memberSubjectId) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Community group member subjectId is required.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const result = await removeCommunityGroupMember(params.groupId, actor, memberSubjectId, now());
      if (result.status === "not_found") {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Community group was not found or cannot be managed by current user.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      if (result.status === "last_manager") {
        return sendError(
          reply,
          409,
          "COMMUNITY_GROUP_LAST_MANAGER",
          "The last active group owner or admin cannot be removed from the group.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      appendAudit(
        state,
        "COMMUNITY_GROUP_MEMBER_REMOVED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          groupId: result.group.groupId,
          memberSubjectId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return result.group;
    },

    upsertGroupMember: async (request, reply) => {
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
      const group = await upsertCommunityGroupMember(
        {
          actor: actorToCommunityActor(actor),
          groupId: params.groupId,
          member: {
            displayName: resolvedMember.member.displayName,
            subjectId: resolvedMember.member.subjectId,
            username: resolvedMember.member.username
          },
          role: resolvedMember.member.role,
          status: resolvedMember.member.status
        },
        requestNow
      );
      if (!group) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Community group was not found or cannot be managed by current user.",
          crypto.randomUUID()
        );
      }
      appendAudit(
        state,
        "COMMUNITY_GROUP_MEMBER_UPSERTED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          groupId: group.groupId,
          memberResolution: resolvedMember.resolution,
          memberSubjectId: resolvedMember.member.subjectId,
          status: resolvedMember.member.status
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return group;
    }
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
      return sendError(
        reply,
        accessError.status,
        accessError.code,
        accessError.message,
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const drawing = await createSketchDrawing(input, requestNow);
    appendAudit(
      state,
      "SKETCH_DRAWING_CREATED",
      {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        drawingId: drawing.id,
        kind: drawing.properties.kind,
        visibility: drawing.properties.visibility
      },
      correlationIdFrom(request.headers["x-correlation-id"])
    );
    return reply.code(201).send(drawing);
  });

  app.get("/api/v1/sketch/drawings/:drawingId", async (request, reply) => {
    const actor = actorFromRequest(request);
    const params = request.params as { drawingId: string };
    const drawing = await readSketchDrawing(params.drawingId);
    const actorGroupIds = await readCommunityActorGroupIds(actor);
    if (!drawing || !canReadSketchDrawingResponse(drawing, actor, actorGroupIds)) {
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Sketch drawing was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
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
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Sketch drawing was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
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
      return sendError(
        reply,
        accessError.status,
        accessError.code,
        accessError.message,
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const updated = await updateSketchDrawing(params.drawingId, actor, input, requestNow);
    if (!updated) {
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Sketch drawing was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    appendAudit(
      state,
      "SKETCH_DRAWING_UPDATED",
      {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        drawingId: updated.id,
        revision: updated.properties.revision
      },
      correlationIdFrom(request.headers["x-correlation-id"])
    );
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
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Sketch drawing was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    appendAudit(
      state,
      "SKETCH_DRAWING_DELETED",
      {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        drawingId: params.drawingId
      },
      correlationIdFrom(request.headers["x-correlation-id"])
    );
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
    appendAudit(
      state,
      "INCIDENT_CREATED",
      {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        category: incident.category,
        incidentId: incident.incidentId,
        severity: incident.severity,
        status: incident.status
      },
      correlationId
    );
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
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Incident was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
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
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Incident was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    appendAudit(
      state,
      "INCIDENT_UPDATED",
      {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        incidentId: incident.incidentId,
        status: incident.status
      },
      correlationId
    );
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
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Incident was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
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
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Incident was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
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
    appendAudit(
      state,
      "INCIDENT_TASK_CREATED",
      {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        incidentId: task.incidentId,
        priority: task.priority,
        status: task.status,
        taskId: task.taskId
      },
      correlationId
    );
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
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Incident task was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
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
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Incident task was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    appendAudit(
      state,
      "INCIDENT_TASK_UPDATED",
      {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        incidentId: task.incidentId,
        status: task.status,
        taskId: task.taskId
      },
      correlationId
    );
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
      : (existing?.preferences ?? {});
    const alertPreferences = hasOwn(body, "alertPreferences")
      ? normalizeAlertPreferences(body.alertPreferences)
      : (existing?.alertPreferences ?? {});

    const profile = await upsertUserProfile({
      alertPreferences,
      displayName: actor.displayName,
      ...(actor.email ? { email: actor.email } : {}),
      preferences,
      subjectId: actor.subjectId,
      username: actor.username
    });
    appendAudit(
      state,
      "USER_PROFILE_UPDATED",
      {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        preferenceKeys: Object.keys(preferences).sort()
      },
      correlationIdFrom(request.headers["x-correlation-id"])
    );

    return {
      actor,
      alertPreferences: profile.alertPreferences,
      preferences: profile.preferences,
      updatedAt: profile.updatedAt
    };
  });

  registerMobileRoutes(app, {
    appleAppSiteAssociation: async (_request, reply) =>
      reply.header("content-type", "application/json").send(appleAppSiteAssociation()),
    bootstrap: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const requestNow = now();
      return buildMobileBootstrap(
        actor,
        requestNow,
        parseMobileSnapshotQuery(request.query as Record<string, unknown>)
      );
    },
    deviceRegister: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const requestNow = now();
      const registration = normalizeMobileDeviceRegistration(request.body, actor, requestNow);
      if (!registration) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Mobile device registration payload does not match contract.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const device = await activeMobileDeviceStore().upsertDevice(registration, "paired", requestNow.toISOString());
      appendAudit(
        state,
        "MOBILE_DEVICE_REGISTERED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          appVersion: registration.appVersion,
          capabilities: registration.capabilities,
          deviceId: registration.deviceId,
          platform: registration.platform,
          pushTokenRegistered: registration.pushTokenRegistered
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return reply.code(202).send({
        actor,
        contractVersion: "cop-mobile-devices-v1",
        device,
        policy: mobileNativePolicy(),
        serverTimestamp: requestNow.toISOString()
      });
    },
    deviceRegistrationTicket: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const appInstanceId = optionalTrimmedString(body.appInstanceId, 200);
      const bundleId = optionalTrimmedString(body.bundleId, 200);
      if (
        !appInstanceId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appInstanceId) ||
        bundleId !== "cz.zeleznalady.csm.messenger"
      ) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Device registration ticket binding is invalid.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const secret = optionalTrimmedString(process.env.COP_DEVICE_REGISTRATION_TICKET_SECRET, 4096);
      if (!secret || Buffer.byteLength(secret) < 32) {
        return sendError(
          reply,
          503,
          "DEPENDENCY_NOT_READY",
          "Device registration ticket issuer is not configured.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const issuedAt = Math.floor(now().getTime() / 1000);
      const expiresAt = issuedAt + 120;
      const claims = {
        appInstanceId,
        aud: "csm-messaging-device-registration",
        bundleId,
        exp: expiresAt,
        iat: issuedAt,
        jti: randomUUID(),
        platform: "ios",
        purpose: "apns-device-registration",
        sub: actor.subjectId
      };
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const signature = createHmac("sha256", secret).update(payload).digest("base64url");
      appendAudit(
        state,
        "MOBILE_DEVICE_REGISTRATION_TICKET_ISSUED",
        { actorSubjectId: actor.subjectId, appInstanceId, expiresAt: new Date(expiresAt * 1000).toISOString() },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return reply.code(201).send({
        contractVersion: "cop-device-registration-ticket-v1",
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        messagingBaseUrl: process.env.COP_CSM_MESSAGING_PUBLIC_URL ?? "https://msg.zeleznalady.cz",
        ticket: `csmrt1.${payload}.${signature}`
      });
    },
    deviceRevoke: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const params = request.params as { deviceId: string };
      const deviceId = normalizeMobileDeviceId(params.deviceId);
      if (!deviceId) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Mobile device id is invalid.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const device = await activeMobileDeviceStore().revokeDevice(actor.subjectId, deviceId, now().toISOString());
      if (!device) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Mobile device was not found.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      appendAudit(
        state,
        "MOBILE_DEVICE_REVOKED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          deviceId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return reply.code(202).send({
        actor,
        contractVersion: "cop-mobile-devices-v1",
        device,
        serverTimestamp: now().toISOString()
      });
    },
    devices: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const devices = await activeMobileDeviceStore().listDevices(actor.subjectId);
      return {
        actor,
        contractVersion: "cop-mobile-devices-v1",
        devices,
        policy: mobileNativePolicy(),
        serverTimestamp: now().toISOString()
      };
    },
    meshAcks: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const query = request.query as Record<string, unknown>;
      const since = optionalIsoDateString(query.since);
      const limit = readBoundedInteger(query.limit, 50, 1, 250);
      const acks = await activeMobileDeviceStore().listMeshAcks(actor.subjectId, since, limit);
      return {
        acks,
        contractVersion: "cop-mobile-mesh-acks-v1",
        serverTimestamp: now().toISOString()
      };
    },
    meshIngest: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const requestNow = now();
      const normalized = normalizeMobileMeshBundle(request.body, actor, requestNow);
      if (!normalized.valid) {
        appendAudit(
          state,
          "MOBILE_MESH_BUNDLE_REJECTED",
          {
            actorAuthMode: actor.authMode,
            actorSubjectId: actor.subjectId,
            reason: normalized.reason
          },
          correlationIdFrom(request.headers["x-correlation-id"])
        );
        return reply.code(422).send(
          mobileMeshAckResponse({
            envelopeId: normalized.envelopeId ?? "invalid",
            receivedAt: requestNow.toISOString(),
            status: "rejected",
            subjectId: actor.subjectId,
            updatedAt: requestNow.toISOString()
          })
        );
      }
      try {
        const result = await activeMobileDeviceStore().ingestMeshBundle(normalized.input);
        appendAudit(
          state,
          "MOBILE_MESH_BUNDLE_INGESTED",
          {
            actorAuthMode: actor.authMode,
            actorSubjectId: actor.subjectId,
            bundleType: normalized.input.bundleType ?? "unknown",
            deviceId: normalized.input.deviceId ?? "unknown",
            envelopeId: normalized.input.envelopeId,
            status: result.record.status
          },
          correlationIdFrom(request.headers["x-correlation-id"])
        );
        return reply.code(result.duplicate ? 200 : 202).send(mobileMeshAckResponse(result.record));
      } catch (error) {
        markMobileDeviceStoreDegraded(error);
        return sendError(
          reply,
          503,
          "MOBILE_DEVICE_STORE_UNAVAILABLE",
          "Mobile mesh ack store is not available.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
    },
    offlineSnapshot: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const requestNow = now();
      return buildMobileSnapshot(actor, requestNow, parseMobileSnapshotQuery(request.query as Record<string, unknown>));
    },
    pairFallback: async (request, reply) => {
      const params = request.params as { code: string };
      const code = normalizeMobilePairingCode(params.code);
      if (!code) {
        return reply.code(400).type("text/html; charset=utf-8").send(mobilePairFallbackHtml("", true));
      }
      return reply.type("text/html; charset=utf-8").send(mobilePairFallbackHtml(code, false));
    },
    pairingClaim: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const params = request.params as { code: string };
      const code = normalizeMobilePairingCode(params.code);
      const requestNow = now();
      const registration = normalizeMobileDeviceRegistration(request.body, actor, requestNow);
      if (!code || !registration) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Mobile pairing claim requires a valid pairing code and device registration payload.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const current = await activeMobileDeviceStore().getPairingSession(code, requestNow.toISOString());
      if (!current) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Mobile pairing session was not found.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      if (current.createdBy.subjectId !== actor.subjectId) {
        return sendError(
          reply,
          403,
          "FORBIDDEN",
          "Mobile pairing code belongs to another user.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const session = await activeMobileDeviceStore().claimPairingSession(
        code,
        mobilePairingActor(actor),
        registration,
        requestNow.toISOString()
      );
      if (!session || session.status !== "claimed") {
        return sendError(
          reply,
          409,
          "PAIRING_NOT_CLAIMABLE",
          "Mobile pairing session is no longer claimable.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      appendAudit(
        state,
        "MOBILE_PAIRING_SESSION_CLAIMED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          code,
          deviceId: registration.deviceId,
          platform: registration.platform
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return mobilePairingSessionResponse(session, request);
    },
    pairingConfirm: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const params = request.params as { code: string };
      const code = normalizeMobilePairingCode(params.code);
      if (!code) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Mobile pairing code is invalid.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const requestNow = now();
      const current = await activeMobileDeviceStore().getPairingSession(code, requestNow.toISOString());
      if (!current) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Mobile pairing session was not found.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      if (current.createdBy.subjectId !== actor.subjectId) {
        return sendError(
          reply,
          403,
          "FORBIDDEN",
          "Mobile pairing code belongs to another user.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      if (current.status !== "claimed" || !current.claimedDevice || current.claimedBy?.subjectId !== actor.subjectId) {
        return sendError(
          reply,
          409,
          "PAIRING_NOT_CONFIRMABLE",
          "Mobile pairing session must be claimed by the same user before confirmation.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const confirmed = await activeMobileDeviceStore().confirmPairingSession(code, requestNow.toISOString());
      if (!confirmed || confirmed.status !== "confirmed" || !confirmed.claimedDevice) {
        return sendError(
          reply,
          409,
          "PAIRING_NOT_CONFIRMABLE",
          "Mobile pairing session could not be confirmed.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const device = await activeMobileDeviceStore().upsertDevice(
        confirmed.claimedDevice,
        "paired",
        requestNow.toISOString(),
        code
      );
      appendAudit(
        state,
        "MOBILE_PAIRING_SESSION_CONFIRMED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          code,
          deviceId: device.deviceId,
          platform: device.platform
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return mobilePairingSessionResponse(confirmed, request, device);
    },
    pairingCreate: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const requestNow = now();
      const ttlSeconds = normalizeMobilePairingTtlSeconds(request.body);
      const expiresAt = new Date(requestNow.getTime() + ttlSeconds * 1000).toISOString();
      try {
        const session = await activeMobileDeviceStore().createPairingSession({
          actor: mobilePairingActor(actor),
          expiresAt,
          now: requestNow.toISOString()
        });
        appendAudit(
          state,
          "MOBILE_PAIRING_SESSION_CREATED",
          {
            actorAuthMode: actor.authMode,
            actorSubjectId: actor.subjectId,
            code: session.code,
            expiresAt: session.expiresAt
          },
          correlationIdFrom(request.headers["x-correlation-id"])
        );
        return reply.code(201).send(mobilePairingSessionResponse(session, request));
      } catch (error) {
        markMobileDeviceStoreDegraded(error);
        return sendError(
          reply,
          503,
          "MOBILE_DEVICE_STORE_UNAVAILABLE",
          "Mobile pairing store is not available.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
    },
    pairingStatus: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const params = request.params as { code: string };
      const code = normalizeMobilePairingCode(params.code);
      if (!code) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Mobile pairing code is invalid.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      const session = await activeMobileDeviceStore().getPairingSession(code, now().toISOString());
      if (!session || !canViewMobilePairingSession(actor, session)) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Mobile pairing session was not found.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      }
      return mobilePairingSessionResponse(session, request);
    }
  });

  registerCommunityReportRoutes(app, {
    listReports: async (request, reply) => {
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
    },

    createReport: async (request, reply) => {
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
          return sendError(
            reply,
            403,
            "FORBIDDEN",
            "Current user cannot publish into the selected community group.",
            crypto.randomUUID()
          );
        }
      }
      const report = await createCommunityReport(input, requestNow);
      appendAudit(
        state,
        "COMMUNITY_REPORT_CREATED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          category: report.category,
          reportId: report.reportId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return reply.code(201).send(communityReportResponseItem(report, requestNow, actor, new Set()));
    },

    updateReport: async (request, reply) => {
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
          return sendError(
            reply,
            403,
            "FORBIDDEN",
            "Current user cannot publish into the selected community group.",
            crypto.randomUUID()
          );
        }
      }
      const requestNow = now();
      const report = await updateCommunityReport(params.reportId, actor, update, requestNow);
      if (!report) {
        return sendError(reply, 404, "NOT_FOUND", "Community report was not found.", crypto.randomUUID());
      }
      appendAudit(
        state,
        "COMMUNITY_REPORT_UPDATED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          reportId: report.reportId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return communityReportResponseItem(report, requestNow, actor, await readCommunityActorGroupIds(actor));
    },

    getReport: async (request, reply) => {
      const actor = actorFromRequest(request);
      const params = request.params as { reportId: string };
      const report = await readCommunityReport(params.reportId);
      if (!report || !canReadCommunityReport(report, actor)) {
        return sendError(reply, 404, "NOT_FOUND", "Community report was not found.", crypto.randomUUID());
      }
      return communityReportResponseItem(report, now(), actor, await readCommunityActorGroupIds(actor));
    },

    deleteReport: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const params = request.params as { reportId: string };
      const deleted = await deleteCommunityReport(params.reportId, actor, now());
      if (!deleted) {
        return sendError(reply, 404, "NOT_FOUND", "Community report was not found.", crypto.randomUUID());
      }
      appendAudit(
        state,
        "COMMUNITY_REPORT_DELETED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          reportId: params.reportId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return reply.code(204).send();
    },

    submitReport: async (request, reply) => {
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
      appendAudit(
        state,
        "COMMUNITY_REPORT_SUBMITTED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          attachmentCount: report.attachments.length,
          category: report.category,
          reportId: report.reportId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      try {
        await dispatchCommunityReportNotification(
          actor,
          report,
          requestNow,
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      } catch (error) {
        appendAudit(
          state,
          "COMMUNITY_REPORT_NOTIFICATION_FAILED",
          {
            actorAuthMode: actor.authMode,
            actorSubjectId: actor.subjectId,
            error: errorMessage(error),
            reportId: report.reportId
          },
          correlationIdFrom(request.headers["x-correlation-id"])
        );
        app.log.warn({ error, reportId: report.reportId }, "Community report notification dispatch failed.");
      }
      return communityReportResponseItem(report, requestNow, actor, new Set());
    },

    createReportAttachment: async (request, reply) => {
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
      const upload = await mediaStorage.createUploadSlot(
        {
          attachmentId,
          byteSize: attachmentRequest.byteSize,
          contentType: attachmentRequest.contentType,
          fileName: attachmentRequest.fileName,
          reportId: report.reportId
        },
        requestNow
      );
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
      appendAudit(
        state,
        "COMMUNITY_ATTACHMENT_UPLOAD_CREATED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          attachmentId,
          byteSize: attachment.byteSize,
          contentType: attachment.contentType,
          kind: attachment.kind,
          reportId: report.reportId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      return reply.code(201).send({
        attachment,
        upload
      });
    },

    completeReportAttachment: async (request, reply) => {
      const actor = requireActor(request, reply);
      if (!actor) {
        return reply;
      }
      const params = request.params as { attachmentId: string; reportId: string };
      const body = isRecord(request.body) ? request.body : {};
      const requestNow = now();
      const attachment = await completeCommunityAttachment({
        attachmentId: params.attachmentId,
        byteSize: optionalFiniteNumber(
          body.byteSize,
          1,
          readPositiveInteger(process.env.COP_MEDIA_MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024)
        ),
        checksumSha256: optionalChecksumSha256(body.checksumSha256),
        completedAt: requestNow.toISOString(),
        reportId: params.reportId,
        subjectId: actor.subjectId
      });
      if (!attachment) {
        return sendError(reply, 404, "NOT_FOUND", "Community report attachment was not found.", crypto.randomUUID());
      }
      appendAudit(
        state,
        "COMMUNITY_ATTACHMENT_UPLOAD_COMPLETED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          attachmentId: attachment.attachmentId,
          reportId: attachment.reportId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      const convertedAttachment = await enqueueSpatialVideoConversion(params.reportId, attachment, requestNow);
      return communityAttachmentResponseItem(convertedAttachment, params.reportId, true, actor, requestNow);
    },

    uploadReportAttachment: async (request, reply) => {
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
      const uploadBody = normalizeCommunityAttachmentUploadBody(
        request.body,
        attachment.byteSize,
        maxCommunityAttachmentBytes
      );
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
      await mediaStorage.putObject(
        {
          body: uploadBody.body,
          contentType: attachment.contentType,
          objectKey: attachment.objectKey
        },
        requestNow
      );
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
      appendAudit(
        state,
        "COMMUNITY_ATTACHMENT_PROXY_UPLOADED",
        {
          actorAuthMode: actor.authMode,
          actorSubjectId: actor.subjectId,
          attachmentId: attachment.attachmentId,
          byteSize: uploadBody.body.length,
          contentType: attachment.contentType,
          reportId: report.reportId
        },
        correlationIdFrom(request.headers["x-correlation-id"])
      );
      const convertedAttachment = await enqueueSpatialVideoConversion(report.reportId, completed, requestNow);
      return communityAttachmentResponseItem(convertedAttachment, report.reportId, true, actor, requestNow);
    },

    getReportAttachmentContent: async (request, reply) => {
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
      const attachment = report.attachments.find(
        (item) => item.attachmentId === params.attachmentId && item.status === "uploaded"
      );
      if (!attachment) {
        return sendError(reply, 404, "NOT_FOUND", "Community report attachment was not found.", crypto.randomUUID());
      }
      const requestNow = now();
      const hasValidTicket = hasValidCommunityMediaTicket(
        request.query,
        {
          attachmentId: params.attachmentId,
          reportId: params.reportId
        },
        requestNow
      );
      if (
        !hasValidTicket &&
        (!canReadCommunityReport(report, actor) ||
          !canReadCommunityAttachment(report, attachment, actor, await readCommunityActorGroupIds(actor)))
      ) {
        return sendError(reply, 404, "NOT_FOUND", "Community report attachment was not found.", crypto.randomUUID());
      }
      const readUrl = await mediaStorage.createReadUrl({ objectKey: attachment.objectKey }, requestNow);
      const range = typeof request.headers.range === "string" ? request.headers.range : undefined;
      const mediaResponse = await fetchMediaStorageContent(readUrl, range);
      if (!mediaResponse.ok && mediaResponse.status !== 206) {
        return sendError(
          reply,
          502,
          "MEDIA_STORAGE_ERROR",
          `Media storage returned HTTP ${mediaResponse.status}.`,
          crypto.randomUUID()
        );
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
      return reply.send(readableResponseBody(mediaResponse));
    },

    getReportAttachmentDerivativeContent: async (request, reply) => {
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
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Community report attachment derivative was not found.",
          crypto.randomUUID()
        );
      }
      const attachment = report.attachments.find(
        (item) => item.attachmentId === params.attachmentId && item.status === "uploaded"
      );
      if (!attachment) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Community report attachment derivative was not found.",
          crypto.randomUUID()
        );
      }
      const requestNow = now();
      const hasValidTicket = hasValidCommunityMediaTicket(
        request.query,
        {
          attachmentId: params.attachmentId,
          derivativeId: params.derivativeId,
          reportId: params.reportId
        },
        requestNow
      );
      if (
        !hasValidTicket &&
        (!canReadCommunityReport(report, actor) ||
          !canReadCommunityAttachment(report, attachment, actor, await readCommunityActorGroupIds(actor)))
      ) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Community report attachment derivative was not found.",
          crypto.randomUUID()
        );
      }
      const derivative = readSpatialDerivative(attachment);
      if (!derivative || derivative.status !== "ready" || !derivative.objectKey) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "Community report attachment derivative was not found.",
          crypto.randomUUID()
        );
      }
      const readUrl = await mediaStorage.createReadUrl({ objectKey: derivative.objectKey }, requestNow);
      const range = typeof request.headers.range === "string" ? request.headers.range : undefined;
      const mediaResponse = await fetchMediaStorageContent(readUrl, range);
      if (!mediaResponse.ok && mediaResponse.status !== 206) {
        return sendError(
          reply,
          502,
          "MEDIA_STORAGE_ERROR",
          `Media storage returned HTTP ${mediaResponse.status}.`,
          crypto.randomUUID()
        );
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
      return reply.send(readableResponseBody(mediaResponse));
    }
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
      return sendError(
        reply,
        503,
        "SOURCE_UNAVAILABLE",
        "Flight airport reference source is disabled.",
        crypto.randomUUID()
      );
    }
    const query = parseFlightAirportQuery(request.query as Record<string, unknown>);
    try {
      return {
        ...(await flightDataSource.fetchAirports(query, requestNow)),
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
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Raster overlay request requires a valid allowlisted raster URL or SIM clean radar path.",
        correlationId
      );
    }
    if (!isAllowedRasterOverlayUrl(rasterUrl)) {
      return sendError(reply, 403, "FORBIDDEN", "Raster overlay host is not allowed.", correlationId);
    }

    try {
      const rasterResponse = await fetchRasterOverlay(rasterUrl);
      if (!rasterResponse.ok) {
        return sendError(
          reply,
          502,
          "UPSTREAM_UNAVAILABLE",
          `Raster overlay provider returned HTTP ${rasterResponse.status}.`,
          correlationId
        );
      }
      const contentType =
        rasterResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
      if (!contentType.startsWith("image/")) {
        return sendError(
          reply,
          502,
          "UPSTREAM_INVALID_RESPONSE",
          "Raster overlay provider did not return an image.",
          correlationId
        );
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
    const cacheSeconds = boundedInteger(
      readPositiveInteger(process.env.COP_WEATHER_RADAR_FRAMES_CACHE_SECONDS, 120),
      60,
      300
    );
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
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Weather camera proxy requires a valid SIM camera detail or snapshot URL.",
        correlationId
      );
    }
    if (!isAllowedWeatherCameraUrl(upstreamUrl)) {
      return sendError(reply, 403, "FORBIDDEN", "Weather camera host is not allowed.", correlationId);
    }

    try {
      const cameraResponse = await fetchWeatherCameraResource(upstreamUrl);
      if (!cameraResponse.ok) {
        return sendError(
          reply,
          502,
          "UPSTREAM_UNAVAILABLE",
          `Weather camera provider returned HTTP ${cameraResponse.status}.`,
          correlationId
        );
      }
      const contentType =
        cameraResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
      const isJson = contentType === "application/json" || contentType.endsWith("+json");
      const isImage = contentType.startsWith("image/");
      if (!isJson && !isImage) {
        return sendError(
          reply,
          502,
          "UPSTREAM_INVALID_RESPONSE",
          "Weather camera provider did not return JSON or image content.",
          correlationId
        );
      }

      const contentLength = Number(cameraResponse.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > weatherCameraMaxBytes) {
        return sendError(
          reply,
          502,
          "UPSTREAM_INVALID_RESPONSE",
          "Weather camera response is too large.",
          correlationId
        );
      }
      const body = Buffer.from(await cameraResponse.arrayBuffer());
      if (body.byteLength > weatherCameraMaxBytes) {
        return sendError(
          reply,
          502,
          "UPSTREAM_INVALID_RESPONSE",
          "Weather camera response is too large.",
          correlationId
        );
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

  app.get("/api/v1/weather-stations/:stationId/detail", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const params = request.params as { stationId: string };
    const stationId = optionalTrimmedString(params.stationId, 220);
    if (!stationId) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Weather station detail requires stationId.", correlationId);
    }
    const query = request.query as Record<string, unknown>;
    const historyHours = boundedQueryInteger(query.historyHours, 48, 1, 168);
    const forecastHours = boundedQueryInteger(query.forecastHours, 24, 0, 72);
    const upstreamUrl = new URL(
      `weather-stations/${encodeURIComponent(stationId)}/detail`,
      `${trimTrailingSlash(situationDataBaseUrl)}/`
    );
    upstreamUrl.searchParams.set("historyHours", String(historyHours));
    upstreamUrl.searchParams.set("forecastHours", String(forecastHours));
    if (optionalTrimmedString(query.nocache, 8) === "1") {
      upstreamUrl.searchParams.set("nocache", "1");
    }

    try {
      const body = await fetchWeatherStationDetailResource(upstreamUrl, situationDataSource?.config.timeoutMs);
      return reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=60").send(body);
    } catch (error) {
      app.log.warn({ error, stationId, upstreamUrl: upstreamUrl.toString() }, "Weather station detail request failed.");
      return sendError(reply, 502, "SITUATION_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
    }
  });

  app.get("/api/v1/weather-forecast/areas/:areaId/detail", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const params = request.params as { areaId: string };
    const areaId = optionalTrimmedString(params.areaId, 220);
    if (!areaId) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Weather forecast area detail requires areaId.", correlationId);
    }
    const query = request.query as Record<string, unknown>;
    const upstreamUrl = new URL(
      `weather-forecast/areas/${encodeURIComponent(areaId)}`,
      `${trimTrailingSlash(situationDataBaseUrl)}/`
    );
    const nowcastHours = optionalBoundedQueryInteger(query.nowcastHours, 0, 48);
    const forecastHours = optionalBoundedQueryInteger(query.forecastHours, 1, 168);
    const dailyDays = optionalBoundedQueryInteger(query.dailyDays, 1, 14);
    if (nowcastHours !== undefined) {
      upstreamUrl.searchParams.set("nowcastHours", String(nowcastHours));
    }
    if (forecastHours !== undefined) {
      upstreamUrl.searchParams.set("forecastHours", String(forecastHours));
    }
    if (dailyDays !== undefined) {
      upstreamUrl.searchParams.set("dailyDays", String(dailyDays));
    }
    if (optionalTrimmedString(query.nocache, 8) === "1") {
      upstreamUrl.searchParams.set("nocache", "1");
    }

    try {
      const body = await fetchWeatherForecastAreaDetailResource(upstreamUrl, situationDataSource?.config.timeoutMs);
      return reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=180").send(body);
    } catch (error) {
      app.log.warn(
        { areaId, error, upstreamUrl: upstreamUrl.toString() },
        "Weather forecast area detail request failed."
      );
      return sendError(reply, 502, "SITUATION_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
    }
  });

  app.get("/api/v1/transit/vehicles/:featureId/detail", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const params = request.params as { featureId: string };
    const featureId = optionalTrimmedString(params.featureId, 260);
    if (!featureId) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Transit vehicle detail requires featureId.", correlationId);
    }
    const query = request.query as Record<string, unknown>;
    const source = optionalTransitSourceId(query.source);
    const upstreamUrl = new URL(
      `transit/vehicles/${encodeURIComponent(featureId)}`,
      `${trimTrailingSlash(situationDataBaseUrl)}/`
    );
    if (source) {
      upstreamUrl.searchParams.set("source", source);
    }
    if (optionalTrimmedString(query.nocache, 8) === "1") {
      upstreamUrl.searchParams.set("nocache", "1");
    }

    try {
      const body = await fetchTransitVehicleDetailResource(upstreamUrl, situationDataSource?.config.timeoutMs);
      return reply.header("Cache-Control", "public, max-age=5, stale-while-revalidate=15").send(body);
    } catch (error) {
      app.log.warn({ error, featureId, upstreamUrl: upstreamUrl.toString() }, "Transit vehicle detail request failed.");
      return sendError(reply, 502, "SITUATION_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
    }
  });

  app.get("/api/v1/transit/stops/:systemId/:stopId/detail", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const params = request.params as { stopId: string; systemId: string };
    const systemId = optionalTransitPathId(params.systemId, 120);
    const stopId = optionalTransitPathId(params.stopId, 180);
    if (!systemId || !stopId) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Transit stop detail requires systemId and stopId.",
        correlationId
      );
    }
    const query = request.query as Record<string, unknown>;
    const source = optionalTransitSourceId(query.source);
    const departuresLimit = boundedQueryInteger(query.departuresLimit, 8, 1, 50);
    const upstreamUrl = new URL(
      `transit/stops/${encodeURIComponent(systemId)}/${encodeURIComponent(stopId)}`,
      `${trimTrailingSlash(situationDataBaseUrl)}/`
    );
    if (source) {
      upstreamUrl.searchParams.set("source", source);
    }
    upstreamUrl.searchParams.set("departuresLimit", String(departuresLimit));
    if (optionalTrimmedString(query.nocache, 8) === "1") {
      upstreamUrl.searchParams.set("nocache", "1");
    }

    try {
      const body = await fetchTransitStopDetailResource(upstreamUrl, situationDataSource?.config.timeoutMs);
      return reply.header("Cache-Control", "public, max-age=15, stale-while-revalidate=30").send(body);
    } catch (error) {
      app.log.warn(
        { error, stopId, systemId, upstreamUrl: upstreamUrl.toString() },
        "Transit stop detail request failed."
      );
      return sendError(reply, 502, "SITUATION_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
    }
  });

  app.get("/api/v1/geocode/search", async (request, reply) => {
    if (!placeGeocoder) {
      return sendError(
        reply,
        503,
        "GEOCODER_UNAVAILABLE",
        "Place geocoder is disabled.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const query = request.query as Record<string, unknown>;
    const q = optionalTrimmedString(query.q ?? query.query, 160);
    if (!q || q.length < 3) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Geocode search requires q with at least 3 characters.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    try {
      const bbox = parseMapQueryBbox(query.bbox ?? query.viewbox);
      return await placeGeocoder.search(
        {
          ...(bbox
            ? {
                bbox,
                bounded:
                  optionalTrimmedString(query.bounded, 8) === "1" || optionalTrimmedString(query.bounded, 8) === "true"
              }
            : {}),
          language: optionalTrimmedString(query.language, 40),
          limit: optionalFiniteNumber(query.limit, 1, 8),
          query: q
        },
        now()
      );
    } catch (error) {
      app.log.warn({ error, q }, "Place geocode search failed.");
      return sendError(
        reply,
        502,
        "GEOCODER_UPSTREAM_UNAVAILABLE",
        errorMessage(error),
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
  });

  app.post("/api/v1/map/query", async (request, reply) => {
    const requestNow = now();
    const actor = actorFromRequest(request);
    const query = parseMapQueryRequest(request.body);
    if (!query) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Map query requires bbox=[west,south,east,north] and layerIds[].",
        crypto.randomUUID()
      );
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
    const selectedLayers = catalog.layers.filter(
      (layer) => query.layerIds.includes(layer.layerId) && catalogLayerAvailableForMapQuery(layer)
    );
    const knownLayerIds = new Set(catalog.layers.map((layer) => layer.layerId));
    const disabledLayerIds = query.layerIds.filter((layerId) =>
      catalog.layers.some((layer) => layer.layerId === layerId && !catalogLayerAvailableForMapQuery(layer))
    );
    const unknownLayerIds = query.layerIds.filter((layerId) => !knownLayerIds.has(layerId));
    const providerQueries = buildProviderFeatureQueries(selectedLayers, query);
    const warnings = [
      ...catalog.warnings,
      ...(disabledLayerIds.length > 0 ? [`Disabled map layers ignored: ${disabledLayerIds.join(", ")}.`] : []),
      ...(unknownLayerIds.length > 0
        ? [`Unknown or unauthorized map layers ignored: ${unknownLayerIds.join(", ")}.`]
        : [])
    ];

    const [
      situationCollection,
      safetyCollection,
      flightCollection,
      communityCollection,
      missionArenaCollection,
      takCollection
    ] = await Promise.all([
      readSituationMapQuery(providerQueries.situation, requestNow, actor, selectedLayers),
      readSafetyMapQuery(providerQueries.safety, requestNow),
      readFlightReferenceMapQuery(providerQueries.flight, requestNow),
      readCommunityMapQuery(providerQueries.community, requestNow, actor),
      readMissionArenaMapQuery(providerQueries.missionArena, requestNow),
      includePartner ? readTakMapQuery(providerQueries.tak, requestNow) : Promise.resolve(undefined)
    ]);

    const featureCount =
      (situationCollection?.summary.featureCount ?? 0) +
      (safetyCollection?.summary.featureCount ?? 0) +
      (flightCollection?.summary.featureCount ?? 0) +
      (communityCollection?.summary.featureCount ?? 0) +
      (missionArenaCollection?.summary.featureCount ?? 0) +
      (takCollection?.summary.featureCount ?? 0);
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

  registerRoutingRoutes(app, {
    profiles: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      if (!routingSource) {
        return sendError(reply, 503, "ROUTING_UNAVAILABLE", "SIM routing source is disabled.", correlationId);
      }
      try {
        return await routingSource.fetchProfiles(requestNow);
      } catch (error) {
        app.log.warn({ error }, "SIM routing profiles request failed.");
        return sendError(reply, 502, "ROUTING_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
      }
    },
    route: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      if (!routingSource) {
        return sendError(reply, 503, "ROUTING_UNAVAILABLE", "SIM routing source is disabled.", correlationId);
      }
      if (!isRecord(request.body)) {
        return sendError(reply, 400, "VALIDATION_ERROR", "Routing route requires a JSON object body.", correlationId);
      }
      try {
        return await routingSource.route(request.body as unknown as RoutingRouteRequest, requestNow);
      } catch (error) {
        const message = errorMessage(error);
        if (message.startsWith("Routing ")) {
          return sendError(reply, 400, "VALIDATION_ERROR", message, correlationId);
        }
        app.log.warn({ error }, "SIM routing route request failed.");
        return sendError(reply, 502, "ROUTING_UPSTREAM_UNAVAILABLE", message, correlationId);
      }
    },
    alternatives: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      if (!routingSource) {
        return sendError(reply, 503, "ROUTING_UNAVAILABLE", "SIM routing source is disabled.", correlationId);
      }
      if (!isRecord(request.body)) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Routing alternatives requires a JSON object body.",
          correlationId
        );
      }
      try {
        return await routingSource.alternatives(request.body as unknown as RoutingRouteRequest, requestNow);
      } catch (error) {
        const message = errorMessage(error);
        if (message.startsWith("Routing ")) {
          return sendError(reply, 400, "VALIDATION_ERROR", message, correlationId);
        }
        app.log.warn({ error }, "SIM routing alternatives request failed.");
        return sendError(reply, 502, "ROUTING_UPSTREAM_UNAVAILABLE", message, correlationId);
      }
    },
    isochrone: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      if (!routingSource) {
        return sendError(reply, 503, "ROUTING_UNAVAILABLE", "SIM routing source is disabled.", correlationId);
      }
      if (!isRecord(request.body)) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Routing isochrone requires a JSON object body.",
          correlationId
        );
      }
      try {
        return await routingSource.isochrone(request.body, requestNow);
      } catch (error) {
        app.log.warn({ error }, "SIM routing isochrone request failed.");
        return sendError(reply, 502, "ROUTING_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
      }
    },
    nearestAccess: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      if (!routingSource) {
        return sendError(reply, 503, "ROUTING_UNAVAILABLE", "SIM routing source is disabled.", correlationId);
      }
      if (!isRecord(request.body)) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Routing nearest-access requires a JSON object body.",
          correlationId
        );
      }
      try {
        return await routingSource.nearestAccess(request.body, requestNow);
      } catch (error) {
        app.log.warn({ error }, "SIM routing nearest-access request failed.");
        return sendError(reply, 502, "ROUTING_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
      }
    }
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
      return sendError(
        reply,
        503,
        "SOURCE_UNAVAILABLE",
        "Safety hydro station detail source is disabled.",
        correlationId
      );
    }
    const query = parseSafetyHydroStationDetailQuery(request.query as Record<string, unknown>);
    if (!query) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Hydro station detail query supports optional from, to and series=H,Q,TH,H_F,Q_F.",
        correlationId
      );
    }
    try {
      return await safetyDataSource.fetchHydroStationDetail(stationId, query, requestNow);
    } catch (error) {
      app.log.warn({ error, stationId }, "Safety hydro station detail failed.");
      return sendError(reply, 502, "SAFETY_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
    }
  });

  registerRadioRoutes(app, {
    createProfile: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      if (!situationDataSource?.createRadioProfile) {
        return sendError(reply, 503, "SOURCE_UNAVAILABLE", "Radio profile source is disabled.", correlationId);
      }
      const profile = parseRadioProfile(request.body);
      if (!profile) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Radio profile requires name, frequencyMhz, antennaHeightM, receiverHeightM and maxRadiusM with non-sensitive fields only.",
          correlationId
        );
      }
      try {
        return await situationDataSource.createRadioProfile(profile, requestNow);
      } catch (error) {
        app.log.warn({ error }, "Radio profile creation failed.");
        return sendError(reply, 502, "SITUATION_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
      }
    },
    linkCheck: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      if (!situationDataSource?.runRadioLinkCheck) {
        return sendError(reply, 503, "SOURCE_UNAVAILABLE", "Radio link-check source is disabled.", correlationId);
      }
      const body = parseRadioLinkCheckRequest(request.body);
      if (!body) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Radio link-check requires from/to coordinates and a profileId or valid custom profile.",
          correlationId
        );
      }
      try {
        return await situationDataSource.runRadioLinkCheck(body, requestNow);
      } catch (error) {
        app.log.warn({ error }, "Radio link-check failed.");
        return sendError(reply, 502, "SITUATION_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
      }
    },
    listProfiles: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      if (!situationDataSource?.fetchRadioProfiles) {
        return sendError(reply, 503, "SOURCE_UNAVAILABLE", "Radio profile source is disabled.", correlationId);
      }
      try {
        return await situationDataSource.fetchRadioProfiles(requestNow);
      } catch (error) {
        app.log.warn({ error }, "Radio profile catalog failed.");
        return sendError(reply, 502, "SITUATION_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
      }
    },
    mobileTowerViewshed: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      const params = request.params as { towerId: string };
      const towerId = parseMobileTowerId(params.towerId);
      if (!towerId) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Mobile tower viewshed requires a valid towerId.",
          correlationId
        );
      }
      if (!situationDataSource?.fetchMobileTowerViewshed) {
        return sendError(reply, 503, "SOURCE_UNAVAILABLE", "Mobile tower viewshed source is disabled.", correlationId);
      }
      const query = parseMobileTowerViewshedQuery(request.query as Record<string, unknown>);
      if (!query) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Mobile tower viewshed supports technology=2G|4G|5G, radiusM, azimuthStepDeg and distanceStepM.",
          correlationId
        );
      }
      try {
        return await situationDataSource.fetchMobileTowerViewshed(towerId, query, requestNow);
      } catch (error) {
        app.log.warn({ error, towerId }, "Mobile tower viewshed failed.");
        const upstreamStatus = upstreamHttpStatus(error);
        if (upstreamStatus === 400 || upstreamStatus === 404) {
          return sendError(
            reply,
            upstreamStatus,
            "MOBILE_TOWER_VIEWSHED_UNAVAILABLE",
            "Pro tento typ objektu není výpočet dostupný.",
            correlationId
          );
        }
        return sendError(reply, 502, "SITUATION_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
      }
    },
    radioCoverage: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      if (!situationDataSource?.runRadioCoverage) {
        return sendError(reply, 503, "SOURCE_UNAVAILABLE", "Radio coverage source is disabled.", correlationId);
      }
      const body = parseRadioCoverageRequest(request.body);
      if (!body) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Radio coverage requires station coordinates and a profileId or valid custom profile.",
          correlationId
        );
      }
      try {
        return await situationDataSource.runRadioCoverage(body, requestNow);
      } catch (error) {
        app.log.warn({ error }, "Radio coverage failed.");
        return sendError(reply, 502, "SITUATION_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
      }
    },
    siteSearch: async (request, reply) => {
      const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
      const requestNow = now();
      if (!situationDataSource?.runRadioSiteSearch) {
        return sendError(reply, 503, "SOURCE_UNAVAILABLE", "Radio site-search source is disabled.", correlationId);
      }
      const body = parseRadioSiteSearchRequest(request.body);
      if (!body) {
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Radio site-search requires a bbox, at least one target and a profileId or valid custom profile.",
          correlationId
        );
      }
      try {
        return await situationDataSource.runRadioSiteSearch(body, requestNow);
      } catch (error) {
        app.log.warn({ error }, "Radio site-search failed.");
        return sendError(reply, 502, "SITUATION_DATA_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationId);
      }
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

  async function queryRuntimeDomainEvents(
    query: ReturnType<typeof parseDomainEventReplayQuery>
  ): Promise<DomainEventReplayResult> {
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
      ackedAt: input.lastAckedOffset >= (previous?.lastAckedOffset ?? 0) ? timestamp : (previous?.ackedAt ?? timestamp),
      lastAckedOffset: Math.max(previous?.lastAckedOffset ?? 0, input.lastAckedOffset),
      lastReplayAt: timestamp,
      nodeId: input.nodeId,
      ...(input.updatedBy
        ? { updatedBy: input.updatedBy }
        : previous?.updatedBy
          ? { updatedBy: previous.updatedBy }
          : {})
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
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Federated node was not found.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    return node;
  });

  app.post("/api/v1/federation/nodes/:nodeId/heartbeat", async (request, reply) => {
    const params = request.params as { nodeId: string };
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const previous = await getFederatedNode(params.nodeId);
    const result = updateFederatedNodeHeartbeat(state, params.nodeId, request.body, now());
    if (!result.ok || !result.node) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        result.message ?? "Federated node heartbeat is invalid.",
        correlationId
      );
    }
    await upsertFederatedNode(result.node);
    const eventType =
      result.node.health === "offline"
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
    appendAudit(
      state,
      "FEDERATED_NODE_HEARTBEAT",
      {
        health: result.node.health,
        nodeId: result.node.nodeId,
        nodeRole: result.node.nodeRole
      },
      correlationId
    );
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
      appendAudit(
        state,
        "DOMAIN_EVENT_REJECTED",
        {
          reason: "validation"
        },
        correlationId
      );
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        parsed.message ?? "Domain event payload does not match contract.",
        correlationId
      );
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
      appendAudit(
        state,
        "DOMAIN_EVENT_REJECTED",
        {
          producerNodeId: parsed.input.producerNodeId,
          reason: "unknown-producer-node"
        },
        correlationId
      );
      return sendError(
        reply,
        422,
        "UNKNOWN_PRODUCER_NODE",
        "Domain event producer node is not registered.",
        correlationId
      );
    }
    const { event } = await publishRuntimeDomainEvent(parsed.input);
    appendAudit(
      state,
      "DOMAIN_EVENT_PUBLISHED",
      {
        channel: event.channel,
        eventId: event.id,
        eventType: event.type,
        producerNodeId: event.data.producerNodeId,
        replayOffset: event.replayOffset
      },
      correlationId
    );
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
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Edge outbox flush requires nodeId and events array.",
        correlationId
      );
    }
    if (events.length > 100) {
      return sendError(
        reply,
        413,
        "BATCH_TOO_LARGE",
        "Edge outbox flush supports at most 100 events per request.",
        correlationId
      );
    }
    const node = await getFederatedNode(nodeId);
    if (!node || node.nodeRole !== "edge-node") {
      return sendError(
        reply,
        422,
        "UNKNOWN_EDGE_NODE",
        "Edge outbox node is not registered as an edge-node.",
        correlationId
      );
    }

    const results: EdgeOutboxFlushItemResult[] = [];
    for (const [index, rawEvent] of events.entries()) {
      const rawRecord = isRecord(rawEvent) ? rawEvent : undefined;
      const clientEventId =
        typeof rawRecord?.clientEventId === "string"
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
    appendAudit(
      state,
      "EDGE_OUTBOX_FLUSHED",
      {
        acceptedCount,
        duplicateCount,
        nodeId,
        rejectedCount
      },
      correlationId
    );
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
      return sendError(
        reply,
        422,
        "UNKNOWN_EDGE_NODE",
        "Replay cursor is available only for registered edge-node.",
        correlationId
      );
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
      return sendError(
        reply,
        422,
        "UNKNOWN_EDGE_NODE",
        "Replay cursor can be acknowledged only by registered edge-node.",
        correlationId
      );
    }
    const body = isRecord(request.body) ? request.body : {};
    const offset = Number(body.lastAckedOffset);
    if (!Number.isInteger(offset) || offset < 0) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Replay cursor acknowledgement requires lastAckedOffset as a non-negative integer.",
        correlationId
      );
    }
    const actor = actorFromRequest(request);
    const cursor = await updateRuntimeEdgeCursor({
      lastAckedOffset: offset,
      nodeId: node.nodeId,
      now: now(),
      updatedBy: actor?.subjectId ?? "cop-api"
    });
    appendAudit(
      state,
      "EDGE_REPLAY_CURSOR_ACKED",
      {
        actorSubjectId: actor?.subjectId,
        lastAckedOffset: cursor.lastAckedOffset,
        nodeId: node.nodeId
      },
      correlationId
    );
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
      return sendError(
        reply,
        422,
        "UNKNOWN_EDGE_NODE",
        "Replay is available only for registered edge-node.",
        correlationId
      );
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
    appendAudit(
      state,
      "EDGE_DOMAIN_EVENTS_REPLAYED",
      {
        blockedByClassification: blockedByClassification.length,
        blockedByReleasePolicy: blockedByReleasePolicy.length,
        deliveredCount: items.length,
        fromOffset: query.fromOffset ?? 0,
        highestScannedOffset,
        nodeId: node.nodeId,
        scannedCount: result.items.length
      },
      correlationId
    );
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
    const candidate =
      body && isRecord(body.event) ? body.event : body && Object.keys(body).length > 0 ? body : deadLetter.body;
    const parsed = parseDomainEventPublishRequest(candidate, correlationId);
    if (!parsed.ok || !parsed.input) {
      appendAudit(
        state,
        "DOMAIN_EVENT_DLQ_REDRIVE_REJECTED",
        {
          deadLetterId: deadLetter.deadLetterId,
          reason: "validation"
        },
        correlationId
      );
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        parsed.message ?? "Dead-letter re-drive event payload does not match contract.",
        correlationId
      );
    }
    const producerNode = await getFederatedNode(parsed.input.producerNodeId);
    if (!producerNode) {
      appendAudit(
        state,
        "DOMAIN_EVENT_DLQ_REDRIVE_REJECTED",
        {
          deadLetterId: deadLetter.deadLetterId,
          producerNodeId: parsed.input.producerNodeId,
          reason: "unknown-producer-node"
        },
        correlationId
      );
      return sendError(
        reply,
        422,
        "UNKNOWN_PRODUCER_NODE",
        "Dead-letter re-drive producer node is not registered.",
        correlationId
      );
    }
    const actor = actorFromRequest(request);
    const result = await redriveRuntimeDomainDeadLetter(deadLetter.deadLetterId, parsed.input, {
      now: now(),
      resolvedBy: actor?.subjectId ?? "cop-api"
    });
    appendAudit(
      state,
      "DOMAIN_EVENT_DLQ_REDRIVEN",
      {
        actorSubjectId: actor?.subjectId,
        deadLetterId: result.deadLetter.deadLetterId,
        eventId: result.event.id,
        replayOffset: result.event.replayOffset,
        status: result.status
      },
      correlationId
    );
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
    appendAudit(
      state,
      "DOMAIN_EVENT_DLQ_RESOLVED",
      {
        actorSubjectId: actor?.subjectId,
        deadLetterId: deadLetter.deadLetterId
      },
      correlationId
    );
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
    const body = request.body as {
      batchId?: string;
      contractVersion?: string;
      sourceSystemId?: string;
      events?: unknown[];
    };
    if (
      !body.batchId ||
      body.contractVersion !== "cop-ingest-v1" ||
      !body.sourceSystemId ||
      !Array.isArray(body.events)
    ) {
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
    const readableItems = selectCurrentTracks(
      state.objects.values(),
      requestNow,
      trackLifecycle,
      includeExpired
    ).filter((object) => {
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
    const currentObjects = selectCurrentTracks(
      state.objects.values(),
      requestNow,
      trackLifecycle,
      includeExpired
    ).filter((object) => canReadObject(subject, object));
    const requestedObjectIds = new Set(query.objectIds ?? []);
    const scopedObjects =
      requestedObjectIds.size > 0
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
      return sendError(
        reply,
        404,
        "NOT_FOUND",
        "Alert was not found in current COP alert evidence.",
        crypto.randomUUID()
      );
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
    writeMessage(
      streamBroadcaster.createSnapshot(subscriptionId, await readableCurrentTracks(subject, snapshotNow), snapshotNow)
    );
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
    const response = await aiGateway.queryCopAssistant(
      validation.data as Parameters<AiGateway["queryCopAssistant"]>[0]
    );
    appendAudit(
      state,
      `AI_REQUEST_${response.status}`,
      { requestId: response.requestId, provider: response.provider },
      correlationId
    );
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
    const readableObjects = prioritizeObjectsForAi(
      selectCurrentTracks(state.objects.values(), requestNow, trackLifecycle).filter((object) =>
        canReadObject(subject, object)
      )
    ).slice(0, maxObjects);
    const decoratedObjects = await decorateObjectsWithConflictEvidence(readableObjects, requestNow);
    const sourceHealth = buildSourceHealthItems(state, requestNow, trackLifecycle);
    const alerts = includeAlerts
      ? (
          await buildAlertItems({
            actor,
            includeAcknowledged: false,
            includeExpired: false,
            requestNow
          })
        ).slice(0, 25)
      : [];
    const communityReports = (
      await listCommunityReports({
        limit: 40,
        statuses: ["submitted", "published"]
      })
    )
      .filter((report) => canReadCommunityReport(report, actor))
      .slice(0, 20);
    const incidents = (
      await listIncidents({
        limit: 20,
        statuses: ["active", "candidate", "monitoring"]
      })
    ).slice(0, 20);
    const aiObjects = decoratedObjects.map(summarizeObjectForAi);
    const aiAlerts = alerts.map(summarizeAlertForAi);
    const aiCommunityReports = communityReports.map(summarizeCommunityReportForAi);
    const aiIncidents = incidents.map(summarizeIncidentForAi);
    const aiSourceHealth = sourceHealth.map(summarizeSourceHealthForAi);
    const priorityContext = buildAiPriorityContext({
      alerts: aiAlerts,
      communityReports: aiCommunityReports,
      incidents: aiIncidents,
      objects: aiObjects,
      sourceHealth: aiSourceHealth
    });
    const requestId = aiRequestId(body.requestId);
    const summaryQuery = [
      "situační souhrn krizové priority povodeň hladina řeky požár bezpečnost policie incident infrastruktura komunita výstrahy",
      aiLanguage(body.language),
      aiIncidents.length ? `incidenty ${aiIncidents.length}` : "",
      aiCommunityReports.length ? `komunitní hlášení ${aiCommunityReports.length}` : "",
      aiAlerts.length ? `výstrahy ${aiAlerts.length}` : "",
      aiObjects.length ? `objekty ${aiObjects.length}` : ""
    ]
      .filter(Boolean)
      .join(" ");
    const retrievalIntent = inferAiRetrievalIntent(summaryQuery);
    const retrievalQuery = buildAiRetrievalQuery(summaryQuery, retrievalIntent);
    const semanticStartedAt = Date.now();
    const semanticContext = await retrieveAiSemanticContext({
      documents: limitAiSemanticDocuments(
        createSemanticDocuments({
          alerts: aiAlerts,
          communityReports: aiCommunityReports,
          incidents: aiIncidents,
          objects: aiObjects,
          sourceHealth: aiSourceHealth
        }),
        aiSemanticRetrievalCandidateLimit,
        retrievalIntent
      ),
      generatedAt: requestNow,
      limit: 12,
      query: retrievalQuery,
      retrievalIntent
    });
    const semanticDurationMs = Date.now() - semanticStartedAt;
    const indexedStartedAt = Date.now();
    const indexedContext = await queryAiContextIndexForAi({
      actor,
      body,
      correlationId,
      geoQuery: summaryQuery,
      query: retrievalQuery,
      retrievalIntent,
      requestId,
      requestNow
    });
    const indexedDurationMs = Date.now() - indexedStartedAt;
    const promptContext = buildAiPromptContextCompression({
      alerts: aiAlerts,
      communityReports: aiCommunityReports,
      generatedAt: requestNow,
      incidents: aiIncidents,
      indexedContext,
      objects: aiObjects,
      priorityContext,
      retrievalIntent,
      semanticContext,
      sourceHealth: aiSourceHealth
    });
    const scope = {
      objectCount: readableObjects.length,
      alertCount: alerts.length,
      communityReportCount: communityReports.length,
      incidentCount: incidents.length,
      sourceCount: sourceHealth.length,
      indexedCandidateDocumentCount: indexedContext.toolCall.candidateDocumentCount,
      indexedDocumentCount: indexedContext.semanticContext.includedDocumentCount,
      semanticDocumentCount: semanticContext.includedDocumentCount
    };
    const uncompressedContext = {
      contractVersion: "cop-ai-situation-summary-v1",
      generatedAt: requestNow.toISOString(),
      retrievalIntent,
      scope,
      priorityContext,
      indexedContext,
      objects: aiObjects,
      alerts: aiAlerts,
      communityReports: aiCommunityReports,
      incidents: aiIncidents,
      sourceHealth: aiSourceHealth,
      semanticContext
    };
    const compressedContext = {
      contractVersion: "cop-ai-situation-summary-v1",
      generatedAt: requestNow.toISOString(),
      retrievalIntent,
      scope,
      priorityContext,
      contextCompression: promptContext.contextCompression,
      indexedContext: promptContext.indexedContext,
      objects: promptContext.objects,
      alerts: promptContext.alerts,
      communityReports: promptContext.communityReports,
      incidents: promptContext.incidents,
      mapFeatures: promptContext.mapFeatures,
      sourceHealth: promptContext.sourceHealth,
      semanticContext: promptContext.semanticContext
    };
    const aiRequest: AiCopQuery = {
      requestId,
      purpose: "COP_EXPLANATION",
      prompt: [
        `Vytvoř stručný situační souhrn pro civilní mapu v jazyce ${aiLanguage(body.language)}.`,
        "Priorita je bezpečnost lidí a majetku: povodně/voda, požáry, zdravotní události, infrastruktura, dopravní omezení, bezpečnostní/policejní incidenty, komunitní hlášení a aktivní výstrahy.",
        "Letecké tracky a stale/low-confidence diagnostiku zmiň jen tehdy, když jsou přímo bezpečnostně relevantní nebo výrazně ovlivňují situační přehled; běžné zastaralé civilní letové tracky nejsou hlavní událost.",
        "Použij priorityContext jako první vodítko, semanticContext jako requestově aktuální bge-m3 výběr a indexedContext jako širší background COP index s geo/časovým filtrem. Neopouštěj přiložený autorizovaný kontext.",
        "U každého důležitého tvrzení přidej citaci ve tvaru [S1] ze semanticContext.citations, [I1] z indexedContext.citations nebo [P1] z priorityContext.citations.",
        "Odděl ověřená data, odhady a chybějící informace. Uveď, když chybí lokální vodní/požární/bezpečnostní evidence.",
        "Nepřidávej vlastní fakta a neformuluj operační pokyny."
      ].join(" "),
      context: compressedContext,
      modelPreference: "fast",
      providerPreference: "auto",
      outputFormat: "MARKDOWN",
      safetyScope: "COP_DATA_ASSISTANCE_ONLY"
    };
    const providerStartedAt = Date.now();
    const providerResponse = await queryCopAssistantForAi(aiRequest, requestNow, "situation-summary");
    const providerDurationMs = Date.now() - providerStartedAt;
    const pipelineObservability = buildAiPipelineObservability({
      compressedContext,
      contextCompression: promptContext.contextCompression,
      indexedDurationMs,
      operation: "situation-summary",
      providerDurationMs,
      retrievalIntent,
      semanticDurationMs,
      uncompressedContext
    });
    const response = withAiResponseEvidence(providerResponse, {
      indexedContext,
      observability: pipelineObservability,
      priorityContext,
      requestContext: aiRequest.context ?? {},
      semanticContext
    });
    appendAudit(
      state,
      `AI_SITUATION_SUMMARY_${response.status}`,
      {
        ...aiAuditMetadata(response, actor),
        indexedDocumentCount: indexedContext.semanticContext.includedDocumentCount,
        indexedStatus: indexedContext.semanticContext.status,
        indexedToolInvocationId: indexedContext.toolCall.invocationId,
        pipelineObservability,
        retrievalIntent,
        semanticDocumentCount: semanticContext.includedDocumentCount,
        semanticStatus: semanticContext.status
      },
      correlationId
    );
    return response;
  });

  app.post("/api/v1/ai/chat-agent/jobs", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const authorization = headerAsString(request.headers.authorization);
    if (!authorization) {
      return sendError(reply, 401, "UNAUTHORIZED", "Authenticated operator identity is required.", correlationId);
    }
    const body = isRecord(request.body) ? request.body : {};
    const question = optionalTrimmedString(body.question, 2000);
    if (!question) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "AI chat agent job requires a non-empty question.",
        correlationId
      );
    }
    pruneAiChatAgentJobs();
    const requestNow = now();
    const jobId = randomUUID();
    const job: AiChatAgentJobRecord = {
      actorSubjectId: actor.subjectId,
      createdAt: requestNow.toISOString(),
      expiresAt: new Date(requestNow.getTime() + aiChatAgentJobTtlMs).toISOString(),
      jobId,
      requestId: optionalUuid(body.requestId) ?? randomUUID(),
      status: "queued",
      updatedAt: requestNow.toISOString()
    };
    aiChatAgentJobs.set(jobId, job);
    appendAudit(
      state,
      "AI_CHAT_AGENT_JOB_QUEUED",
      {
        actorAuthMode: actor.authMode,
        actorSubjectId: actor.subjectId,
        conversationId: optionalText(body.conversationId),
        groupId: optionalText(body.groupId),
        jobId,
        requestId: job.requestId
      },
      correlationId
    );
    startAiChatAgentJob({
      authorization,
      body: {
        ...body,
        requestId: job.requestId
      },
      correlationId,
      jobId
    });
    reply.code(202);
    return aiChatAgentJobPayload(job);
  });

  app.get("/api/v1/ai/chat-agent/jobs/:jobId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const params = isRecord(request.params) ? request.params : {};
    const jobId = optionalUuid(params.jobId);
    if (!jobId) {
      return sendError(reply, 400, "VALIDATION_ERROR", "AI chat agent jobId must be a UUID.", correlationId);
    }
    pruneAiChatAgentJobs();
    const job = aiChatAgentJobs.get(jobId);
    if (!job) {
      return sendError(reply, 404, "NOT_FOUND", "AI chat agent job was not found or has expired.", correlationId);
    }
    if (job.actorSubjectId !== actor.subjectId) {
      return sendError(reply, 403, "FORBIDDEN", "Current user cannot read this AI chat agent job.", correlationId);
    }
    return aiChatAgentJobPayload(job);
  });

  app.post("/api/v1/ai/chat-agent/query", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const requestNow = now();
    const body = isRecord(request.body) ? request.body : {};
    const question = optionalTrimmedString(body.question, 2000);
    if (!question) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "AI chat agent query requires a non-empty question.",
        correlationId
      );
    }
    const rawGroupId = optionalText(body.groupId);
    const groupId = rawGroupId ? optionalUuid(rawGroupId) : undefined;
    if (rawGroupId && !groupId) {
      return sendError(reply, 400, "VALIDATION_ERROR", "AI chat agent groupId must be a UUID.", correlationId);
    }
    const group = groupId ? await readCommunityGroup(groupId) : null;
    if (groupId && (!group || !canUseCommunityGroupForReport(group, actor))) {
      return sendError(
        reply,
        403,
        "FORBIDDEN",
        "Current user cannot use the AI chat agent for the selected group.",
        correlationId
      );
    }
    if (group && summarizeGroupAiAssistantForAi(group).enabled !== true) {
      return sendError(
        reply,
        409,
        "AI_CHAT_AGENT_DISABLED",
        "AI chat agent is not enabled for the selected group.",
        correlationId
      );
    }
    const chatContext = summarizeAiChatContextForAi(body.chatContext);
    const modelPreference = aiModelPreference(body.modelPreference) ?? "auto";
    const requestId = aiRequestId(body.requestId);
    const subject = defaultSystemSubject();
    const maxObjects = readBoundedInteger(body.maxObjects, 30, 1, 60);
    const readableObjects = prioritizeObjectsForAi(
      selectCurrentTracks(state.objects.values(), requestNow, trackLifecycle).filter((object) =>
        canReadObject(subject, object)
      )
    ).slice(0, maxObjects);
    const decoratedObjects = await decorateObjectsWithConflictEvidence(readableObjects, requestNow);
    const sourceHealth = buildSourceHealthItems(state, requestNow, trackLifecycle);
    const alerts = (
      await buildAlertItems({
        actor,
        includeAcknowledged: false,
        includeExpired: false,
        requestNow
      })
    ).slice(0, 20);
    const communityReports = (
      await listCommunityReports({
        limit: 40,
        statuses: ["submitted", "published"]
      })
    )
      .filter((report) => canReadCommunityReport(report, actor))
      .slice(0, 20);
    const incidents = (await listIncidents({ limit: 20 })).slice(0, 20);
    const aiObjects = decoratedObjects.map(summarizeObjectForAi);
    const aiAlerts = alerts.map(summarizeAlertForAi);
    const aiCommunityReports = communityReports.map(summarizeCommunityReportForAi);
    const aiIncidents = incidents.map(summarizeIncidentForAi);
    const aiSourceHealth = sourceHealth.map(summarizeSourceHealthForAi);
    const aiMapSearch = await resolveAiMapSearchContextForChatAgent({
      actor,
      body,
      question,
      requestId,
      requestNow
    });
    const aiMapFeatures = aiMapSearch?.results ?? [];
    const priorityContext = buildAiPriorityContext({
      alerts: aiAlerts,
      chatContext,
      communityReports: aiCommunityReports,
      incidents: aiIncidents,
      mapFeatures: aiMapFeatures,
      objects: aiObjects,
      sourceHealth: aiSourceHealth
    });
    const retrievalIntent = inferAiRetrievalIntent(question);
    const responsePlaybook = aiResponsePlaybookGuidanceForQuestion(question);
    const responsePlaybookPrompt = aiResponsePlaybookPromptGuidance(question);
    const retrievalQuery = buildAiRetrievalQuery(question, retrievalIntent);
    const semanticStartedAt = Date.now();
    const semanticContext = await retrieveAiSemanticContext({
      documents: limitAiSemanticDocuments(
        createSemanticDocuments({
          alerts: aiAlerts,
          chatContext,
          communityReports: aiCommunityReports,
          incidents: aiIncidents,
          mapFeatures: aiMapFeatures,
          objects: aiObjects,
          sourceHealth: aiSourceHealth
        }),
        aiSemanticRetrievalCandidateLimit,
        retrievalIntent
      ),
      generatedAt: requestNow,
      limit: 12,
      query: retrievalQuery,
      retrievalIntent
    });
    const semanticDurationMs = Date.now() - semanticStartedAt;
    const indexedStartedAt = Date.now();
    const indexedContext = await queryAiContextIndexForAi({
      actor,
      body,
      correlationId,
      geoQuery: question,
      query: retrievalQuery,
      retrievalIntent,
      requestId,
      requestNow
    });
    const indexedDurationMs = Date.now() - indexedStartedAt;
    const promptContext = buildAiPromptContextCompression({
      alerts: aiAlerts,
      ...(chatContext ? { chatContext } : {}),
      communityReports: aiCommunityReports,
      generatedAt: requestNow,
      incidents: aiIncidents,
      indexedContext,
      mapFeatures: aiMapFeatures,
      objects: aiObjects,
      priorityContext,
      retrievalIntent,
      semanticContext,
      sourceHealth: aiSourceHealth
    });
    const chat = compactRecord({
      conversationId: optionalText(body.conversationId),
      groupId: group?.groupId,
      groupName: group?.name,
      aiAssistant: group ? summarizeGroupAiAssistantForAi(group) : undefined,
      activeMemberCount: group ? group.members.filter((member) => member.status === "active").length : undefined
    });
    const scope = {
      objectCount: readableObjects.length,
      alertCount: alerts.length,
      chatMessageCount:
        chatContext && isRecord(chatContext) ? readBoundedInteger(chatContext.includedMessageCount, 0, 0, 60) : 0,
      communityReportCount: communityReports.length,
      incidentCount: incidents.length,
      mapSearchResultCount: aiMapSearch?.results.length ?? 0,
      sourceCount: sourceHealth.length,
      indexedCandidateDocumentCount: indexedContext.toolCall.candidateDocumentCount,
      indexedDocumentCount: indexedContext.semanticContext.includedDocumentCount,
      semanticDocumentCount: semanticContext.includedDocumentCount
    };
    const uncompressedContext = {
      contractVersion: "cop-ai-chat-agent-query-v1",
      generatedAt: requestNow.toISOString(),
      question,
      retrievalIntent,
      responsePlaybook,
      chat,
      chatContext,
      mapSearch: aiMapSearch,
      priorityContext,
      scope,
      objects: aiObjects,
      alerts: aiAlerts,
      communityReports: aiCommunityReports,
      incidents: aiIncidents,
      mapFeatures: aiMapFeatures,
      sourceHealth: aiSourceHealth,
      indexedContext,
      semanticContext
    };
    const compressedContext = {
      contractVersion: "cop-ai-chat-agent-query-v1",
      generatedAt: requestNow.toISOString(),
      question,
      retrievalIntent,
      responsePlaybook,
      chat,
      chatContext: promptContext.chatContext,
      mapSearch: aiMapSearch,
      priorityContext,
      contextCompression: promptContext.contextCompression,
      scope,
      objects: promptContext.objects,
      alerts: promptContext.alerts,
      communityReports: promptContext.communityReports,
      incidents: promptContext.incidents,
      mapFeatures: promptContext.mapFeatures,
      sourceHealth: promptContext.sourceHealth,
      indexedContext: promptContext.indexedContext,
      semanticContext: promptContext.semanticContext
    };
    const aiRequest: AiCopQuery = {
      requestId,
      purpose: "COP_EXPLANATION",
      prompt: [
        `Odpověz jako viditelný AI agent v COP chatu v jazyce ${aiLanguage(body.language)}.`,
        "Použij přiložený COP kontext napříč objekty, výstrahami, komunitními hlášeními, incidenty, stavem zdrojů a explicitně poskytnutým chatContext.",
        "Pro dotazy typu najdi/vyhledej/nejbližší použij mapSearch a priorityContext.mapSnapshot před obecnou semantickou evidencí; pokud mapSearch obsahuje výsledky, uveď konkrétní název, vzdálenost, souřadnice a citaci.",
        "U mapových vyhledávacích dotazů odpověz stručně jako konkrétní nález a další možný krok; nevytvářej obecný situační přehled, pokud uživatel žádá jen vyhledání místa nebo objektu.",
        "Použij priorityContext pro krizovou důležitost, semanticContext jako requestově aktuální bge-m3 výběr COP entit a chatových výňatků a indexedContext jako širší background COP index s geo/časovým filtrem; uveď, když je retrieval degraded nebo prázdný.",
        "Bezpečnostní priority jsou voda/povodeň, požár, zdravotní riziko, infrastruktura, dopravní omezení, bezpečnostní/policejní incident a komunitní hlášení; civilní lety a stale civilní letové tracky nejsou priorita a zmiň je jen při explicitním leteckém dotazu nebo přímé bezpečnostní souvislosti.",
        "Důležitá tvrzení cituj pomocí [S1] ze semanticContext.citations, [I1] z indexedContext.citations nebo [P1] z priorityContext.citations.",
        "Respektuj retrievalIntent a contextCompression: pokud jsou záznamy vynechané z promptu, neber to jako důkaz jejich neexistence.",
        "Odpověz nejprve přímo a lidsky. Interní identifikátory zdrojů a vrstev, například MAX_Z nebo chmi_weather_radar, ani souřadnice nevypisuj, pokud si je uživatel výslovně nevyžádal.",
        responsePlaybookPrompt
          ? `Respektuj responsePlaybook pro záměr, zdroje, nejistotu a UI akce. ${responsePlaybookPrompt}`
          : "Pokud responsePlaybook není k dispozici, drž se obecného COP kontextu a nevyvozuj UI akce bez dat.",
        "ChatContext ber jen jako výňatek viditelné dešifrované timeline poskytnutý klientem; nedovozuj neviděnou historii místnosti.",
        "Jasně odděl ověřená data, odhady a chybějící informace. Neformuluj taktické pokyny, targeting ani doporučení použití síly.",
        `Dotaz uživatele: ${question}`
      ].join(" "),
      context: compressedContext,
      ...(modelPreference ? { modelPreference } : {}),
      providerPreference: "auto",
      outputFormat: "MARKDOWN",
      safetyScope: "COP_DATA_ASSISTANCE_ONLY"
    };
    const weatherLocationClarificationResponse = shouldClarifyAiWeatherLocation(question, aiMapSearch)
      ? aiWeatherLocationClarificationResponse(aiRequest, requestNow)
      : undefined;
    const deterministicMapSearchResponse = !weatherLocationClarificationResponse
      && shouldAnswerAiChatAgentWithMapSearchResult(question, body, aiMapSearch)
      ? aiMapSearchFallbackResponse(
          aiRequest,
          requestNow,
          "Explicit COP map search resolved by the read-only map tool."
        )
      : undefined;
    const deterministicEmptyMapSearchResponse =
      !weatherLocationClarificationResponse
      && !deterministicMapSearchResponse
      && shouldAnswerAiChatAgentWithEmptyMapSearchResult(question, body, aiMapSearch)
        ? aiMapSearchNoResultFallbackResponse(
            aiRequest,
            requestNow,
            "Explicit COP map search returned no matching object."
          )
        : undefined;
    const providerStartedAt = Date.now();
    const candidateProviderResponse =
      weatherLocationClarificationResponse ??
      deterministicMapSearchResponse ??
      deterministicEmptyMapSearchResponse ??
      (await queryCopAssistantForAi(aiRequest, requestNow, "chat-agent"));
    const providerResponse =
      isGeneralWeatherForecastQuestion(question)
      && candidateProviderResponse.status !== "COMPLETED"
      && aiMapSearch
        ? aiMapSearchFallbackResponse(
            aiRequest,
            requestNow,
            "The AI provider did not complete the weather synthesis; COP used a verified weather-data fallback."
          ) ?? candidateProviderResponse
        : candidateProviderResponse;
    const providerDurationMs =
      weatherLocationClarificationResponse || deterministicMapSearchResponse || deterministicEmptyMapSearchResponse
        ? 0
        : Date.now() - providerStartedAt;
    const pipelineObservability = buildAiPipelineObservability({
      compressedContext,
      contextCompression: promptContext.contextCompression,
      indexedDurationMs,
      operation: "chat-agent",
      providerDurationMs,
      retrievalIntent,
      semanticDurationMs,
      uncompressedContext
    });
    const response = withAiResponseEvidence(providerResponse, {
      indexedContext,
      mapSearch: aiMapSearch,
      observability: pipelineObservability,
      priorityContext,
      requestContext: aiRequest.context ?? {},
      semanticContext
    });
    appendAudit(
      state,
      `AI_CHAT_AGENT_${response.status}`,
      {
        ...aiAuditMetadata(response, actor),
        chatMessageCount:
          chatContext && isRecord(chatContext) ? readBoundedInteger(chatContext.includedMessageCount, 0, 0, 60) : 0,
        conversationId: optionalText(body.conversationId),
        groupId: group?.groupId,
        indexedDocumentCount: indexedContext.semanticContext.includedDocumentCount,
        indexedStatus: indexedContext.semanticContext.status,
        indexedToolInvocationId: indexedContext.toolCall.invocationId,
        pipelineObservability,
        retrievalIntent,
        semanticDocumentCount: semanticContext.includedDocumentCount,
        semanticStatus: semanticContext.status
      },
      correlationId
    );
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
      case "cop.community.reports.search": {
        result = await buildCopCommunityReportSearchToolResult(input, actor ?? null);
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
    appendAudit(
      state,
      "MCP_TOOL_INVOKED",
      {
        actorSubjectId: actor?.subjectId,
        durationMs,
        invocationId,
        mode: tool.mode,
        status: "ok",
        toolId: tool.toolId
      },
      correlationId
    );
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
    const selectedLayers = catalog.layers.filter(
      (layer) => query.layerIds.includes(layer.layerId) && catalogLayerAvailableForMapQuery(layer)
    );
    const knownLayerIds = new Set(catalog.layers.map((layer) => layer.layerId));
    const disabledLayerIds = query.layerIds.filter((layerId) =>
      catalog.layers.some((layer) => layer.layerId === layerId && !catalogLayerAvailableForMapQuery(layer))
    );
    const unknownLayerIds = query.layerIds.filter((layerId) => !knownLayerIds.has(layerId));
    const providerQueries = buildProviderFeatureQueries(selectedLayers, query);
    const warnings = [
      ...catalog.warnings,
      ...(disabledLayerIds.length > 0 ? [`Disabled map layers ignored: ${disabledLayerIds.join(", ")}.`] : []),
      ...(unknownLayerIds.length > 0
        ? [`Unknown or unauthorized map layers ignored: ${unknownLayerIds.join(", ")}.`]
        : [])
    ];

    const [
      situationCollection,
      safetyCollection,
      flightCollection,
      communityCollection,
      missionArenaCollection,
      takCollection
    ] = await Promise.all([
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

  async function buildCopCommunityReportSearchToolResult(
    input: Record<string, unknown>,
    actor: AuthenticatedActor | null
  ): Promise<Record<string, unknown>> {
    const requestNow = now();
    const bbox = parseMapQueryBbox(input.bbox) ?? floodDemoBbox;
    const categories = Array.isArray(input.categories)
      ? Array.from(new Set(input.categories.filter(isCommunityReportCategory))).slice(0, 9)
      : [];
    const severities = Array.isArray(input.severities)
      ? Array.from(new Set(input.severities.filter(isCommunityReportHazardSeverity))).slice(0, 3)
      : [];
    const includeExpired = parseBooleanQuery(input.includeExpired);
    const limit = optionalFiniteNumber(input.limit, 1, 200) ?? 50;
    const reports = (
      await listCommunityReports({
        bbox,
        ...(categories.length > 0 ? { categories } : {}),
        limit: Math.min(limit * 2, 400),
        statuses: ["submitted", "published"]
      })
    )
      .filter((report) => canReadCommunityReport(report, actor))
      .filter((report) => includeExpired || !isCommunityReportStale(report, requestNow))
      .filter((report) => severities.length === 0 || severities.includes(communityReportSeverity(report)))
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))
      .slice(0, limit);
    const items = reports.map((report) =>
      compactRecord({
        attachmentCount: report.attachments.filter((attachment) => attachment.status === "uploaded").length,
        category: report.category,
        description: report.description?.slice(0, 600),
        location: {
          accuracyM: report.location.accuracyM,
          lat: roundCoordinate(report.location.lat),
          lon: roundCoordinate(report.location.lon),
          source: report.location.source
        },
        observedAt: report.observedAt,
        reportId: report.reportId,
        severity: communityReportSeverity(report),
        stale: isCommunityReportStale(report, requestNow),
        status: report.status,
        submittedAt: report.submittedAt,
        title: report.title,
        updatedAt: report.updatedAt,
        validUntil: communityReportValidUntil(report),
        visibility: report.visibility
      })
    );
    return {
      contractVersion: "cop-community-report-search-v1",
      generatedAt: requestNow.toISOString(),
      items,
      query: {
        bbox,
        categories,
        includeExpired,
        limit,
        severities
      },
      safety: {
        chatMessagesIncluded: false,
        mediaUrlsIncluded: false,
        personalIdentitiesIncluded: false,
        policyFiltered: true
      },
      summary: {
        count: items.length,
        criticalCount: reports.filter((report) => communityReportSeverity(report) === "critical").length,
        staleCount: reports.filter((report) => isCommunityReportStale(report, requestNow)).length
      }
    };
  }

  function buildCopSourcesHealthToolResult(input: Record<string, unknown>): Record<string, unknown> {
    const requestNow = now();
    const includeDisabled = parseBooleanQuery(input.includeDisabled);
    const healthFilter = optionalString(input.health, [
      "DEGRADED",
      "DISABLED",
      "ONLINE",
      "QUIET",
      "STALE",
      "UNAVAILABLE",
      "WAITING"
    ]);
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
      return id === undefined
        ? undefined
        : mcpJsonRpcError(id, -32600, "Invalid Request", "Expected JSON-RPC 2.0 MCP request.");
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

  async function readMapCatalogProviders(
    requestNow: Date,
    actor: AuthenticatedActor | null,
    includePartner: boolean
  ): Promise<{
    flight: NonNullable<BuildMapCatalogInput["flight"]>;
    missionArena: NonNullable<BuildMapCatalogInput["missionArena"]>;
    safety: NonNullable<BuildMapCatalogInput["safety"]>;
    situation: NonNullable<BuildMapCatalogInput["situation"]>;
    tak?: NonNullable<BuildMapCatalogInput["tak"]>;
  }> {
    const [situation, safety, flight, missionArena, tak] = await Promise.all([
      withCatalogProviderTimeout("sim.situation-data", readSituationCatalogProvider(requestNow, actor), () =>
        unavailableSituationCatalogProvider("Situation data")
      ),
      withCatalogProviderTimeout("sim.safety-data", readSafetyCatalogProvider(requestNow), () =>
        unavailableSafetyCatalogProvider("Safety data")
      ),
      withCatalogProviderTimeout("sim.flight-data", readFlightCatalogProvider(requestNow), () =>
        unavailableFlightCatalogProvider("Flight data")
      ),
      withCatalogProviderTimeout("csm.mission-arena", readMissionArenaCatalogProvider(requestNow), () =>
        unavailableMissionArenaCatalogProvider("Mission Arena")
      ),
      includePartner
        ? withCatalogProviderTimeout("sim.tak-gateway", readTakCatalogProvider(requestNow), () =>
            unavailableTakCatalogProvider("TAK Gateway")
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

  function withCatalogProviderTimeout<T>(providerId: string, operation: Promise<T>, fallback: () => T): Promise<T> {
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
          app.log.warn(
            { error, providerId },
            "Map catalog provider rejected before timeout; returning degraded catalog slice."
          );
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
      const [catalog, layers, rawSources, taxonomy] = await Promise.all([
        situationDataSource.fetchCatalog ? situationDataSource.fetchCatalog(requestNow) : Promise.resolve(undefined),
        situationDataSource.fetchLayers(requestNow),
        situationDataSource.fetchSources(requestNow),
        readSituationTaxonomy(requestNow)
      ]);
      const sources = filterSituationSourcesForActor(rawSources, actor);
      const health = buildSituationDataHealth(layers, requestNow, taxonomy);
      state.sources.set(
        situationDataSource.sourceSystem.sourceSystemId,
        withSituationDataHealth(activeSituationDataSourceSystem(), health)
      );
      return {
        catalog,
        layers,
        sources,
        status: "online" as const
      };
    } catch (error) {
      const health = unavailableSituationDataHealth(error, requestNow);
      state.sources.set(
        situationDataSource.sourceSystem.sourceSystemId,
        withSituationDataHealth(activeSituationDataSourceSystem(), health)
      );
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
      const [catalog, layers, sources, observability, taxonomy] = await Promise.all([
        safetyDataSource.fetchCatalog ? safetyDataSource.fetchCatalog(requestNow) : Promise.resolve(undefined),
        safetyDataSource.fetchLayers(requestNow),
        safetyDataSource.fetchSources(requestNow),
        readSafetyObservability(requestNow),
        readSafetyTaxonomy(requestNow)
      ]);
      const health = buildSafetyDataHealth(layers, requestNow, observability, taxonomy);
      state.sources.set(
        safetyDataSource.sourceSystem.sourceSystemId,
        withSafetyDataHealth(activeSafetyDataSourceSystem(), health)
      );
      return {
        catalog,
        layers,
        sources,
        status: "online" as const
      };
    } catch (error) {
      const health = unavailableSafetyDataHealth(error, requestNow);
      state.sources.set(
        safetyDataSource.sourceSystem.sourceSystemId,
        withSafetyDataHealth(activeSafetyDataSourceSystem(), health)
      );
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

  async function readSituationTaxonomy(requestNow: Date) {
    if (!situationDataSource?.fetchTaxonomy) {
      return undefined;
    }
    try {
      return await situationDataSource.fetchTaxonomy(requestNow);
    } catch (error) {
      appendAudit(state, "MAP_CATALOG_SITUATION_TAXONOMY_FAILED", {
        error: errorMessage(error),
        sourceSystemId: situationDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Situation data taxonomy request failed.");
      return undefined;
    }
  }

  async function readSafetyTaxonomy(requestNow: Date) {
    if (!safetyDataSource?.fetchTaxonomy) {
      return undefined;
    }
    try {
      return await safetyDataSource.fetchTaxonomy(requestNow);
    } catch (error) {
      appendAudit(state, "MAP_CATALOG_SAFETY_TAXONOMY_FAILED", {
        error: errorMessage(error),
        sourceSystemId: safetyDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Safety data taxonomy request failed.");
      return undefined;
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
      state.sources.set(
        takGatewaySource.sourceSystem.sourceSystemId,
        withTakGatewayHealth(activeTakGatewaySourceSystem(), health)
      );
      return {
        catalog,
        layers,
        sources,
        status: "online" as const
      };
    } catch (error) {
      const health = unavailableTakGatewayHealth(error, requestNow);
      state.sources.set(
        takGatewaySource.sourceSystem.sourceSystemId,
        withTakGatewayHealth(activeTakGatewaySourceSystem(), health)
      );
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
      state.sources.set(
        missionArenaSource.sourceSystem.sourceSystemId,
        withMissionArenaHealth(activeMissionArenaSourceSystem(), health)
      );
      return {
        layers,
        sources,
        status: "online" as const
      };
    } catch (error) {
      const health = unavailableMissionArenaHealth(error, requestNow);
      state.sources.set(
        missionArenaSource.sourceSystem.sourceSystemId,
        withMissionArenaHealth(activeMissionArenaSourceSystem(), health)
      );
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
      const actorFilteredCollection = filterSituationCollectionForActor(
        await situationDataSource.fetchFeatures(sanitized.query, requestNow),
        actor,
        sanitized.warnings
      );
      const collection = filterSituationCollectionForCatalogLayers(actorFilteredCollection, selectedLayers);
      const health = buildSituationDataHealth(collection, requestNow);
      state.sources.set(
        situationDataSource.sourceSystem.sourceSystemId,
        withSituationDataHealth(activeSituationDataSourceSystem(), health)
      );
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableSituationDataHealth(error, requestNow);
      state.sources.set(
        situationDataSource.sourceSystem.sourceSystemId,
        withSituationDataHealth(activeSituationDataSourceSystem(), health)
      );
      appendAudit(state, "MAP_QUERY_SITUATION_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: situationDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Situation data map query failed.");
      return {
        ...emptySituationFeatureCollection(sanitized.query, requestNow, [
          health.lastError ?? "Situation data features are unavailable."
        ]),
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
      state.sources.set(
        safetyDataSource.sourceSystem.sourceSystemId,
        withSafetyDataHealth(activeSafetyDataSourceSystem(), health)
      );
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableSafetyDataHealth(error, requestNow);
      state.sources.set(
        safetyDataSource.sourceSystem.sourceSystemId,
        withSafetyDataHealth(activeSafetyDataSourceSystem(), health)
      );
      appendAudit(state, "MAP_QUERY_SAFETY_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: safetyDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Safety data map query failed.");
      return {
        ...emptySafetyFeatureCollection(query, requestNow, [
          health.lastError ?? "Safety data features are unavailable."
        ]),
        sourceHealth: health
      };
    }
  }

  async function readFlightReferenceMapQuery(
    query: FlightReferenceFeatureQuery | undefined,
    requestNow: Date
  ): Promise<(FlightReferenceFeatureCollection & { sourceHealth?: SourceHealthOverride }) | undefined> {
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
      state.sources.set(
        flightDataSource.sourceSystem.sourceSystemId,
        withFlightDataHealth(activeFlightDataSourceSystem(), health)
      );
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableFlightDataHealth(error, requestNow);
      state.sources.set(
        flightDataSource.sourceSystem.sourceSystemId,
        withFlightDataHealth(activeFlightDataSourceSystem(), health)
      );
      appendAudit(state, "MAP_QUERY_FLIGHT_REFERENCE_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: flightDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Flight reference map query failed.");
      return {
        ...emptyFlightReferenceFeatureCollection(query, requestNow, [
          health.lastError ?? "Flight reference features are unavailable."
        ]),
        sourceHealth: health
      };
    }
  }

  async function readCommunityMapQuery(
    query: CommunityMapFeatureQuery | undefined,
    requestNow: Date,
    actor: AuthenticatedActor | null
  ) {
    if (!query) {
      return undefined;
    }
    try {
      const reports = (
        await listCommunityReports({
          bbox: query.bbox,
          includeOwnDrafts: Boolean(actor),
          limit: query.limit,
          ...(actor ? { subjectId: actor.subjectId } : {})
        })
      ).filter((report) => canReadCommunityReport(report, actor));
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

  async function readMissionArenaMapQuery(
    query: MissionArenaFeatureQuery | undefined,
    requestNow: Date
  ): Promise<(MissionArenaFeatureCollection & { sourceHealth?: SourceHealthOverride }) | undefined> {
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
      state.sources.set(
        missionArenaSource.sourceSystem.sourceSystemId,
        withMissionArenaHealth(activeMissionArenaSourceSystem(), health)
      );
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableMissionArenaHealth(error, requestNow);
      state.sources.set(
        missionArenaSource.sourceSystem.sourceSystemId,
        withMissionArenaHealth(activeMissionArenaSourceSystem(), health)
      );
      appendAudit(state, "MAP_QUERY_MISSION_ARENA_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: missionArenaSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Mission Arena map query failed.");
      return {
        ...emptyMissionArenaFeatureCollection(query, requestNow, [
          health.lastError ?? "Mission Arena features are unavailable."
        ]),
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
      state.sources.set(
        takGatewaySource.sourceSystem.sourceSystemId,
        withTakGatewayHealth(activeTakGatewaySourceSystem(), health)
      );
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableTakGatewayHealth(error, requestNow);
      state.sources.set(
        takGatewaySource.sourceSystem.sourceSystemId,
        withTakGatewayHealth(activeTakGatewaySourceSystem(), health)
      );
      appendAudit(state, "MAP_QUERY_TAK_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: takGatewaySource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "TAK Gateway map query failed.");
      return {
        ...emptyTakGatewayFeatureCollection(query, requestNow, [
          health.lastError ?? "TAK Gateway features are unavailable."
        ]),
        sourceHealth: health
      };
    }
  }

  async function readableCurrentTracks(
    subject: ReturnType<typeof defaultSystemSubject>,
    requestNow: Date
  ): Promise<ObservedObject[]> {
    const objects = selectCurrentTracks(state.objects.values(), requestNow, trackLifecycle).filter((object) =>
      canReadObject(subject, object)
    );
    return decorateObjectsWithConflictEvidence(objects, requestNow);
  }

  async function publishCurrentTracks(objects: ObservedObject[]): Promise<void> {
    const subject = defaultSystemSubject();
    const requestNow = now();
    const readableObjects = decorateObjectsWithInMemoryConflictEvidence(
      objects.filter((object) => canReadObject(subject, object)),
      requestNow
    );
    const message = streamBroadcaster.createObjectUpserts(readableObjects, requestNow);
    if (message) {
      await streamBus.publish(message);
      streamBusDetail = streamBus.diagnostics();
      streamBusStatus = streamBus.metrics.ready || streamBus.name === "memory" ? "ok" : "degraded";
    }
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
    appendAudit(
      state,
      "INGEST_REJECTED",
      { reason: sourceCheck.code, sourceSystemId: event.source.sourceSystemId },
      correlationId
    );
    return sendError(reply, sourceCheck.statusCode, sourceCheck.code, sourceCheck.message, correlationId);
  }

  if (!sourceCheck.source.allowedEventTypes.includes(event.eventType)) {
    return sendError(
      reply,
      422,
      "EVENT_TYPE_NOT_ALLOWED",
      "Source is not allowed to publish this event type.",
      correlationId
    );
  }

  if (!sourceCheck.source.allowedObjectTypes.includes(event.payload.objectType)) {
    return sendError(
      reply,
      422,
      "OBJECT_TYPE_NOT_ALLOWED",
      "Source is not allowed to publish this object type.",
      correlationId
    );
  }

  if (sourceCheck.source.synthetic && event.simulation?.synthetic !== true) {
    return sendError(
      reply,
      422,
      "SYNTHETIC_FLAG_REQUIRED",
      "Synthetic source must mark events as synthetic.",
      correlationId
    );
  }

  const key = headerAsString(headers["x-idempotency-key"]);
  if (!key) {
    return sendError(reply, 400, "IDEMPOTENCY_KEY_REQUIRED", "X-Idempotency-Key header is required.", correlationId);
  }

  const hash = hashPayload(event);
  const previous = state.idempotency.get(key);
  if (previous && previous.hash !== hash) {
    appendAudit(state, "IDEMPOTENCY_CONFLICT", { eventId: event.eventId }, correlationId);
    return sendError(
      reply,
      409,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was reused with different content.",
      correlationId
    );
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
  appendAudit(
    state,
    "INGEST_ACCEPTED",
    { eventId: event.eventId, sourceSystemId: event.source.sourceSystemId },
    correlationId
  );
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

function withSimSearchDataHealth(source: SourceSystem, health: SourceHealthOverride): SourceSystem {
  return {
    ...source,
    attributes: {
      ...source.attributes,
      sourceHealth: health,
      simSearchDataHealth: health
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

function readSimSearchDataHealth(source: SourceSystem | undefined): SourceHealthOverride | undefined {
  return readSourceHealthFromAttributes(source?.attributes?.simSearchDataHealth ?? source?.attributes?.sourceHealth);
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
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : undefined
  };
}

function isSourceHealthOverride(value: unknown): value is SourceHealthOverride["health"] {
  return (
    value === "DEGRADED" || value === "ONLINE" || value === "STALE" || value === "UNAVAILABLE" || value === "WAITING"
  );
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
  const providerWarnings = providerSlices.flatMap((slice) =>
    slice.warnings.map((warning) => `${slice.label}: ${warning}`)
  );
  const uncertainties = Array.from(
    new Set([
      ...input.warnings,
      ...providerWarnings,
      ...providerSlices.flatMap((slice) =>
        slice.health && slice.health !== "ONLINE" ? [`${slice.label} health is ${slice.health}.`] : []
      )
    ])
  ).slice(0, 20);
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
  const label = areaSummaryText(properties, [
    "headline",
    "label",
    "title",
    "name",
    "areaName",
    "sourceName",
    "featureId"
  ]);
  if (!label) {
    return [];
  }
  const severity = normalizeAreaSummarySeverity(
    properties.severity ?? properties.hazardSeverity ?? properties.floodStage ?? properties.status
  );
  const location = areaSummaryFeatureLocation(feature, properties);
  return [
    {
      ...(areaSummaryText(properties, ["category"]) ? { category: areaSummaryText(properties, ["category"]) } : {}),
      ...(optionalFiniteNumber(properties.confidence, 0, 1) !== undefined
        ? { confidence: optionalFiniteNumber(properties.confidence, 0, 1) }
        : {}),
      ...(areaSummaryText(properties, ["recommendedAction", "description", "summary"], 240)
        ? { detail: areaSummaryText(properties, ["recommendedAction", "description", "summary"], 240) }
        : {}),
      ...(areaSummaryText(properties, ["featureId", "reportId", "stationId"], 160)
        ? { featureId: areaSummaryText(properties, ["featureId", "reportId", "stationId"], 160) }
        : {}),
      label,
      ...(areaSummaryText(properties, ["layer", "layerId"], 120)
        ? { layer: areaSummaryText(properties, ["layer", "layerId"], 120) }
        : {}),
      ...(location ? { location } : {}),
      ...(areaSummaryText(properties, ["observedAt", "updatedAt", "effectiveAt", "validFrom"], 80)
        ? { observedAt: areaSummaryText(properties, ["observedAt", "updatedAt", "effectiveAt", "validFrom"], 80) }
        : {}),
      providerId,
      severity,
      ...(areaSummaryText(properties, ["sourceId", "source"], 120)
        ? { sourceId: areaSummaryText(properties, ["sourceId", "source"], 120) }
        : {}),
      stale: properties.stale === true,
      ...(areaSummaryText(properties, ["validUntil", "expiresAt", "forecastUntil"], 80)
        ? { validUntil: areaSummaryText(properties, ["validUntil", "expiresAt", "forecastUntil"], 80) }
        : {})
    }
  ];
}

function areaSummaryFeatureProperties(feature: unknown): Record<string, unknown> {
  return isRecord(feature) && isRecord(feature.properties) ? feature.properties : {};
}

function areaSummaryFeatureLocation(
  feature: unknown,
  properties: Record<string, unknown>
): AreaSummaryLocation | undefined {
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
  return Array.from(
    new Set(
      value.flatMap((source) => {
        if (!isRecord(source)) {
          return [];
        }
        const sourceId = optionalTrimmedString(source.sourceId, 160);
        return sourceId ? [sourceId] : [];
      })
    )
  ).sort();
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
    headline: areaFusionHeadline(
      priorities,
      Number.isFinite(summaryFeatureCount) ? summaryFeatureCount : evidence.length
    ),
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
  return [
    {
      ...(optionalTrimmedString(candidate.category, 120)
        ? { category: optionalTrimmedString(candidate.category, 120) }
        : {}),
      ...(optionalFiniteNumber(candidate.confidence, 0, 1) !== undefined
        ? { confidence: optionalFiniteNumber(candidate.confidence, 0, 1) }
        : {}),
      ...(optionalTrimmedString(candidate.detail, 240) ? { detail: optionalTrimmedString(candidate.detail, 240) } : {}),
      evidenceId: featureId ?? areaFusionStableId("evidence", { index, label, layer, providerId }),
      ...(featureId ? { featureId } : {}),
      label,
      ...(layer ? { layer } : {}),
      ...(location ? { location } : {}),
      ...(optionalTrimmedString(candidate.observedAt, 80)
        ? { observedAt: optionalTrimmedString(candidate.observedAt, 80) }
        : {}),
      providerId,
      severity: normalizeAreaSummarySeverity(candidate.severity),
      ...(sourceId ? { sourceId } : {}),
      stale: candidate.stale === true,
      ...(optionalTrimmedString(candidate.validUntil, 80)
        ? { validUntil: optionalTrimmedString(candidate.validUntil, 80) }
        : {})
    }
  ];
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
  return groups.map(buildAreaFusionPriority).sort(compareAreaFusionPriorities).slice(0, limit);
}

function areaFusionCanJoinGroup(group: AreaFusionEvidence[], item: AreaFusionEvidence): boolean {
  const lead = group[0];
  if (!lead) {
    return false;
  }
  const categoryMatch = areaFusionCategoryKey(lead) === areaFusionCategoryKey(item);
  const severityClose = Math.abs(areaSummarySeverityRank(lead.severity) - areaSummarySeverityRank(item.severity)) <= 1;
  if (lead.location && item.location) {
    return (
      areaFusionHaversineMeters(lead.location.lat, lead.location.lon, item.location.lat, item.location.lon) <= 3_000 &&
      (categoryMatch || severityClose)
    );
  }
  return categoryMatch && severityClose;
}

function buildAreaFusionPriority(group: AreaFusionEvidence[]): AreaFusionPriority {
  const sortedEvidence = [...group].sort(compareAreaFusionEvidence);
  const top = sortedEvidence[0] ?? group[0];
  const severity = sortedEvidence.reduce<AreaSummarySeverity>(
    (highest, item) =>
      areaSummarySeverityRank(item.severity) > areaSummarySeverityRank(highest) ? item.severity : highest,
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
    priorityId: areaFusionStableId(
      "fusion",
      sortedEvidence.map((item) => item.evidenceId)
    ),
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
  const locations = evidence.flatMap((item) => (item.location ? [item.location] : []));
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
  const geometryWarning =
    evidence.length > 0 && locatedEvidenceCount === 0
      ? ["Fúze nemá k dispozici přesnou polohu vybraných podkladů; prostorová korelace je omezená."]
      : [];
  const staleWarning = evidence.some((item) => item.stale) ? ["Některé podklady jsou označené jako zastaralé."] : [];
  return Array.from(new Set([...base, ...geometryWarning, ...staleWarning])).slice(0, 20);
}

function areaFusionOverallConfidence(
  priorities: AreaFusionPriority[],
  uncertainties: string[]
): "high" | "low" | "medium" {
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
  return priorities.length > 1 ? `${top.title}; dalších priorit: ${priorities.length - 1}.` : top.title;
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
  return (degrees * Math.PI) / 180;
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
  const healthCounts = items.reduce<Record<string, number>>(
    (counts, item) => ({
      ...counts,
      [item.health]: (counts[item.health] ?? 0) + 1
    }),
    {}
  );
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
    limit: optionalFiniteNumber(body.limit, 1, 5000) ?? 250
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

function parseMobileTowerId(value: unknown): string | null {
  const towerId = optionalTrimmedString(value, 240);
  const normalizedTowerId = normalizeMobileTowerId(towerId);
  if (!normalizedTowerId || !/^[a-z0-9:_./-]+$/iu.test(normalizedTowerId)) {
    return null;
  }
  return normalizedTowerId;
}

function normalizeMobileTowerId(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const legacyFeatureMatch = value.match(
    /^mobile:osm_postgis:(node|way|relation|area):([^:]+)(?::communications_tower)?$/iu
  );
  if (legacyFeatureMatch?.[1] && legacyFeatureMatch[2]) {
    return `${legacyFeatureMatch[1].toLowerCase()}:${legacyFeatureMatch[2]}`;
  }
  const legacyTowerMatch = value.match(/^(node|way|relation|area):([^:]+):communications_tower$/iu);
  if (legacyTowerMatch?.[1] && legacyTowerMatch[2]) {
    return `${legacyTowerMatch[1].toLowerCase()}:${legacyTowerMatch[2]}`;
  }
  return value;
}

function parseMobileTowerViewshedQuery(value: Record<string, unknown>): MobileTowerViewshedQuery | null {
  const technology = value.technology === undefined ? "4G" : optionalTrimmedString(value.technology, 8)?.toUpperCase();
  if (technology !== "2G" && technology !== "4G" && technology !== "5G") {
    return null;
  }
  const radiusM = boundedOptionalInteger(value.radiusM, 12_000, 1_000, 50_000);
  const azimuthStepDeg = boundedOptionalInteger(value.azimuthStepDeg, 10, 1, 45);
  const distanceStepM = boundedOptionalInteger(value.distanceStepM, 500, 100, 5_000);
  if (radiusM === null || azimuthStepDeg === null || distanceStepM === null) {
    return null;
  }
  return {
    azimuthStepDeg,
    distanceStepM,
    radiusM,
    technology
  };
}

function parseRadioProfile(value: unknown): RadioProfile | null {
  if (!isRecord(value) || containsForbiddenRadioField(value)) {
    return null;
  }
  const name = optionalTrimmedString(value.name, 80);
  const frequencyMhz = optionalFiniteNumber(value.frequencyMhz, 1, 6000);
  const antennaHeightM = optionalFiniteNumber(value.antennaHeightM, 0.1, 120);
  const receiverHeightM = optionalFiniteNumber(value.receiverHeightM, 0.1, 120);
  const maxRadiusM = optionalFiniteNumber(value.maxRadiusM, 100, 100000);
  if (
    !name ||
    frequencyMhz === undefined ||
    antennaHeightM === undefined ||
    receiverHeightM === undefined ||
    maxRadiusM === undefined
  ) {
    return null;
  }
  const antennaGainDbi = optionalFiniteNumber(value.antennaGainDbi, -20, 60);
  const profileId = optionalRadioIdentifier(value.profileId, 80);
  const receiverSensitivityDbm = optionalFiniteNumber(value.receiverSensitivityDbm, -160, -20);
  const requiredFresnelClearancePct = optionalFiniteNumber(value.requiredFresnelClearancePct, 0, 100);
  const systemLossDb = optionalFiniteNumber(value.systemLossDb, 0, 80);
  const txPowerW = optionalFiniteNumber(value.txPowerW, 0, 100);
  return {
    ...(antennaGainDbi !== undefined ? { antennaGainDbi } : {}),
    antennaHeightM,
    frequencyMhz,
    maxRadiusM,
    name,
    ...(profileId ? { profileId } : {}),
    receiverHeightM,
    ...(receiverSensitivityDbm !== undefined ? { receiverSensitivityDbm } : {}),
    ...(requiredFresnelClearancePct !== undefined ? { requiredFresnelClearancePct } : {}),
    ...(systemLossDb !== undefined ? { systemLossDb } : {}),
    ...(txPowerW !== undefined ? { txPowerW } : {})
  };
}

function parseRadioCoverageRequest(value: unknown): RadioCoverageRequest | null {
  if (!isRecord(value) || containsForbiddenRadioField(value)) {
    return null;
  }
  const base = parseRadioRequestBase(value);
  const station = parseRadioPoint(value.station);
  if (!base || !station) {
    return null;
  }
  return {
    ...base,
    azimuthStepDeg: boundedOptionalInteger(value.azimuthStepDeg, 5, 1, 45) ?? undefined,
    distanceStepM: boundedOptionalInteger(value.distanceStepM, 250, 50, 5_000) ?? undefined,
    radiusM: boundedOptionalInteger(value.radiusM, base.profile?.maxRadiusM ?? 15_000, 100, 100_000) ?? undefined,
    station
  };
}

function parseRadioLinkCheckRequest(value: unknown): RadioLinkCheckRequest | null {
  if (!isRecord(value) || containsForbiddenRadioField(value)) {
    return null;
  }
  const base = parseRadioRequestBase(value);
  const from = parseRadioPoint(value.from);
  const to = parseRadioPoint(value.to);
  return base && from && to ? { ...base, from, to } : null;
}

function parseRadioSiteSearchRequest(value: unknown): RadioSiteSearchRequest | null {
  if (!isRecord(value) || containsForbiddenRadioField(value)) {
    return null;
  }
  const base = parseRadioRequestBase(value);
  const searchArea = parseRadioSearchArea(value.searchArea);
  const targets = Array.isArray(value.targets)
    ? value.targets
        .flatMap((target) => {
          const point = parseRadioPoint(target);
          return point ? [point] : [];
        })
        .slice(0, 20)
    : [];
  if (!base || !searchArea || targets.length === 0) {
    return null;
  }
  return {
    ...base,
    gridStepM: boundedOptionalInteger(value.gridStepM, 250, 50, 5_000) ?? undefined,
    maxCandidates: boundedOptionalInteger(value.maxCandidates, 20, 1, 100) ?? undefined,
    searchArea,
    targets
  };
}

function parseRadioRequestBase(value: Record<string, unknown>): RadioProfileRequestBase | null {
  const profile = isRecord(value.profile) ? parseRadioProfile(value.profile) : undefined;
  const profileId = optionalRadioIdentifier(value.profileId, 80);
  if (!profile && !profileId) {
    return null;
  }
  const radioName = optionalTrimmedString(value.radioName, 80);
  return {
    ...(profile ? { profile } : {}),
    ...(profileId ? { profileId } : {}),
    ...(radioName ? { radioName } : {})
  };
}

function parseRadioPoint(value: unknown): RadioPoint | null {
  if (!isRecord(value)) {
    return null;
  }
  const lat = optionalFiniteNumber(value.lat, -90, 90);
  const lon = optionalFiniteNumber(value.lon, -180, 180);
  if (lat === undefined || lon === undefined) {
    return null;
  }
  const antennaHeightM = optionalFiniteNumber(value.antennaHeightM, 0.1, 120);
  const receiverHeightM = optionalFiniteNumber(value.receiverHeightM, 0.1, 120);
  return {
    ...(antennaHeightM !== undefined ? { antennaHeightM } : {}),
    lat,
    lon,
    ...(receiverHeightM !== undefined ? { receiverHeightM } : {})
  };
}

function parseRadioSearchArea(value: unknown): RadioSiteSearchRequest["searchArea"] | null {
  if (!isRecord(value) || !Array.isArray(value.bbox) || value.bbox.length !== 4) {
    return null;
  }
  const parts = value.bbox.map(Number);
  if (!parts.every(Number.isFinite)) {
    return null;
  }
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west >= east || south >= north) {
    return null;
  }
  return {
    bbox: [
      clampNumber(west, -180, 180),
      clampNumber(south, -90, 90),
      clampNumber(east, -180, 180),
      clampNumber(north, -90, 90)
    ]
  };
}

function optionalRadioIdentifier(value: unknown, maxLength: number): string | undefined {
  const identifier = optionalTrimmedString(value, maxLength);
  return identifier && /^[a-z0-9:_./-]+$/iu.test(identifier) ? identifier : undefined;
}

function containsForbiddenRadioField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenRadioField);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(
    ([key, nested]) => forbiddenRadioFieldPattern.test(key) || containsForbiddenRadioField(nested)
  );
}

const forbiddenRadioFieldPattern =
  /^(?:callsign|comsec|crypto|classified|encryption|freqplan|frequencyplan|hopping|key|keys|notes?|rfplan|secret|tactical|utajovane|utajeni)$/iu;

function boundedOptionalInteger(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
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
  const layers =
    requestedLayers.length > 0
      ? requestedLayers
      : (["weather_alerts", "warnings", "fire", "flood"] satisfies SafetyLayerId[]);
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
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const normalized = Array.from(
    new Set(values.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim().slice(0, 160)] : [])))
  ).slice(0, 100);
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
  return Array.from(
    new Set(raw.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])))
  ).slice(0, 128);
}

function normalizeMapQueryFilters(value: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (!key.trim() || !isRecord(entry)) {
        return [];
      }
      return [[key.trim(), entry]];
    })
  );
}

function buildProviderFeatureQueries(
  layers: MapCatalogLayer[],
  request: MapFeatureQueryRequest
): ProviderFeatureQueries {
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
    const supportedFeatureQuery =
      layer.query.mode === "bbox" || (layer.query.mode === "grid" && layer.query.providerId === "sim.situation-data");
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
      situationTechnology =
        situationTechnology ??
        readMapQueryTechnology(request.filters[layer.layerId]) ??
        readDefaultTechnologyFilter(layer);
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

function catalogLayerAvailableForMapQuery(layer: MapCatalogLayer): boolean {
  return layer.enabled !== false && layer.availability !== "disabled";
}

function catalogLayerQueryableForFeatureQuery(layer: MapCatalogLayer): boolean {
  return (
    layer.query.mode === "bbox" || (layer.query.mode === "grid" && layer.query.providerId === "sim.situation-data")
  );
}

function mapFeatureCollectionWarnings(collection: unknown): string[] {
  if (!isRecord(collection) || !Array.isArray(collection.warnings)) {
    return [];
  }
  return collection.warnings.filter(
    (warning): warning is string => typeof warning === "string" && warning.trim() !== ""
  );
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
  return (
    value === "air_quality" ||
    value === "air_quality_grid" ||
    value === "boundary_admin" ||
    value === "boundary_country" ||
    value === "boundary_district" ||
    value === "boundary_municipality" ||
    value === "boundary_orp" ||
    value === "boundary_region" ||
    value === "community_places" ||
    value === "fire" ||
    value === "flood" ||
    value === "ground" ||
    value === "mobile" ||
    value === "mobile_coverage" ||
    value === "mobile_network" ||
    value === "outdoor_webcams" ||
    value === "place_settlements" ||
    value === "trail_poi" ||
    value === "trail_routes" ||
    value === "traffic" ||
    value === "warnings" ||
    value === "weather_alerts" ||
    value === "weather_forecast_area" ||
    value === "weather_webcams" ||
    value === "weather" ||
    value === "weather_humidity_grid" ||
    value === "weather_precipitation_grid" ||
    value === "weather_pressure_grid" ||
    value === "weather_radar_nowcast" ||
    value === "weather_radar_precipitation" ||
    value === "weather_radar_reflectivity" ||
    value === "weather_temperature_grid" ||
    value === "weather_thunderstorm_risk" ||
    value === "weather_wind_field"
  );
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
    case "weather.forecast_area":
    case "weather_forecast_area":
    case "public.weather.forecast_area":
      return "weather_forecast_area";
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
    case "trail.routes":
    case "trail_routes":
    case "public.trails.routes":
    case "outdoor.osm_postgis.trail_routes":
      return "trail_routes";
    case "trail.poi":
    case "trail_poi":
    case "public.trails.poi":
    case "outdoor.osm_postgis.trail_poi":
      return "trail_poi";
    case "community_places":
    case "public.outdoor.community_places":
    case "outdoor.community.places":
      return "community_places";
    case "outdoor.webcams":
    case "outdoor_webcams":
    case "public.outdoor.webcams":
      return "outdoor_webcams";
    default:
      return undefined;
  }
}

function isSafetyLayerId(value: string): value is SafetyLayerId {
  return (
    value === "boundary_admin" ||
    value === "fire" ||
    value === "flood" ||
    value === "warnings" ||
    value === "weather_alerts"
  );
}

function isSafetyDataSourceId(value: string): value is SafetyDataSourceId {
  return (
    value === "admin_boundaries" ||
    value === "chmi_alerts" ||
    value === "chmi_hydro" ||
    value === "fire_hotspots" ||
    value === "fire_incidents" ||
    value === "gdacs_alerts" ||
    value === "hzs_incidents" ||
    value === "municipal_alerts" ||
    value === "mock" ||
    value === "nasa_firms" ||
    value === "road_srti_lod" ||
    value === "weather_alerts"
  );
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

function sanitizeSituationQueryForActor(
  query: SituationFeatureQuery,
  actor: AuthenticatedActor | null
): { blocked: boolean; query: SituationFeatureQuery; warnings: string[] } {
  const sources = query.sources;
  if (!sources || sources.length === 0) {
    return { blocked: false, query, warnings: [] };
  }
  const allowedSources = sources.filter((sourceId) => canReadSituationSource(sourceId, actor));
  const blockedSources = sources.filter((sourceId) => !allowedSources.includes(sourceId));
  const warnings =
    blockedSources.length > 0 ? [`Restricted situation source hidden: ${blockedSources.join(", ")}.`] : [];
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
  const situationLayers = selectedLayers.filter(
    (layer) =>
      (layer.query.mode === "bbox" || layer.query.mode === "grid") && layer.query.providerId === "sim.situation-data"
  );
  if (situationLayers.length === 0) {
    return collection;
  }
  const features = collection.features.filter((feature) =>
    situationLayers.some((layer) => situationFeatureMatchesCatalogLayer(feature, layer))
  );
  const sourceIds = new Set(features.map((feature) => feature.properties.sourceId));
  const sources =
    sourceIds.size > 0 ? collection.sources.filter((source) => sourceIds.has(source.sourceId)) : collection.sources;
  const warnings = collection.warnings;
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

function situationFeatureMatchesCatalogLayer(feature: SituationFeature, layer: MapCatalogLayer): boolean {
  if (isMobileNetworkCoverageFallbackForCatalogLayer(feature, layer)) {
    return true;
  }
  const providerLayerIds = layer.query.providerLayerIds ?? [];
  if (providerLayerIds.length > 0) {
    const normalizedProviderLayerIds = providerLayerIds
      .map(situationLayerIdFromProviderLayerId)
      .filter((value): value is SituationLayerId => Boolean(value));
    const rawLayerMatch =
      providerLayerIds.includes(feature.properties.layer) ||
      providerLayerIds.includes(feature.properties.layerId ?? "") ||
      providerLayerIds.includes(feature.properties.providerLayerId ?? "");
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
  if (
    categoryIds.length > 0 &&
    !categoryIds.map(normalizeSituationCategoryId).includes(normalizeSituationCategoryId(feature.properties.category))
  ) {
    return false;
  }
  return true;
}

function isMobileNetworkCoverageFallbackForCatalogLayer(feature: SituationFeature, layer: MapCatalogLayer): boolean {
  return (
    layer.layerId === "public.mobile.network" &&
    (layer.query.providerLayerIds ?? []).includes("mobile_network") &&
    feature.properties.layer === "mobile_coverage" &&
    feature.properties.sourceId === "mobile_coverage_model"
  );
}

function normalizeSituationCategoryId(value: string): string {
  return value.toLowerCase().replace(/[\s.-]+/g, "_");
}

function filterSituationSourcesForActor(
  sources: SituationSourceDescriptor[],
  actor: AuthenticatedActor | null
): SituationSourceDescriptor[] {
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

function canReadBySyntheticFlag(
  subject: ReturnType<typeof defaultSystemSubject>,
  synthetic: boolean | undefined
): boolean {
  const decision = evaluateReadPolicy(subject, {
    classification: "UNCLASSIFIED",
    synthetic
  });
  return decision.allowed;
}

function filterStreamMessage(
  subject: ReturnType<typeof defaultSystemSubject>,
  message: CopStreamMessage
): CopStreamMessage | null {
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

function parseCommunityReportQuery(
  query: Record<string, unknown>,
  actor: AuthenticatedActor | null
): CommunityReportQuery {
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
    ...(optionalTrimmedString(value.description, 2000)
      ? { description: optionalTrimmedString(value.description, 2000) }
      : {}),
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
    ? (optionalTrimmedString(value.description, 2000) ?? null)
    : undefined;
  const hazardSeverity = isCommunityReportHazardSeverity(value.hazardSeverity)
    ? value.hazardSeverity
    : isCommunityReportHazardSeverity(value.severity)
      ? value.severity
      : undefined;
  const validUntil = hasOwn(value, "validUntil") ? (optionalIsoTimestamp(value.validUntil) ?? null) : undefined;
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
  return Array.from(
    new Set(
      [actor.subjectId, actor.username, actor.email]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
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
      attachments: [
        floodDemoAttachmentSeed(
          "photo",
          "IMG_4821.jpg",
          "Rozliv u silnice",
          "Voda zasahuje okraj komunikace u Roztok."
        ),
        floodDemoAttachmentSeed(
          "document",
          "Situacni_zprava_Roztoky.pdf",
          "Koordinační PDF",
          "Souhrn opatření, kontakty a doporučená trasa."
        )
      ],
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
      attachments: [
        floodDemoAttachmentSeed(
          "photo",
          "Most_Zbraslav.jpg",
          "Poškozený most",
          "Viditelné narušení krajnice a omezený průjezd."
        ),
        floodDemoAttachmentSeed(
          "video",
          "Most_Zbraslav_prutok.mp4",
          "Průtok u mostu",
          "Krátké video dokumentuje rychlost proudění."
        )
      ],
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
      attachments: [
        floodDemoAttachmentSeed(
          "photo",
          "Nabrezi_uzavirka.jpg",
          "Uzavřené nábřeží",
          "Stojící voda a naplaveniny na vozovce."
        ),
        floodDemoAttachmentSeed(
          "document",
          "Objizdna_trasa.pdf",
          "Objízdná trasa",
          "Stručný přehled navržené objízdné trasy."
        )
      ],
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

function floodDemoAttachmentSeed(kind: CommunityAttachmentKind, fileName: string, caption: string, summary: string) {
  const isDocument = kind === "document";
  const contentType = kind === "photo" ? "image/png" : kind === "video" ? "video/mp4" : "application/pdf";
  const previewUrl = floodDemoPreviewDataUrl(kind, caption, summary);
  return {
    byteSize: kind === "video" ? 18_000_000 : isDocument ? 1_200_000 : 2_400_000,
    caption,
    contentType,
    ...(kind === "photo" ? { contentUrl: previewUrl } : {}),
    fileName,
    kind,
    previewUrl
  };
}

function floodDemoPreviewDataUrl(kind: CommunityAttachmentKind, title: string, subtitle: string): string {
  const palette =
    kind === "photo"
      ? { accent: "#0891b2", bg: "#dff7f2", fg: "#083344", icon: "IMG" }
      : kind === "video"
        ? { accent: "#dc2626", bg: "#fee2e2", fg: "#450a0a", icon: "▶" }
        : { accent: "#2563eb", bg: "#dbeafe", fg: "#172554", icon: "PDF" };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${palette.bg}" offset="0"/><stop stop-color="#ffffff" offset="1"/></linearGradient></defs>
<rect width="960" height="640" fill="url(#g)"/>
<path d="M0 450 C160 390 270 520 430 460 C600 395 735 425 960 350 L960 640 L0 640 Z" fill="${palette.accent}" opacity=".18"/>
<circle cx="145" cy="130" r="72" fill="${palette.accent}" opacity=".9"/>
<text x="145" y="145" text-anchor="middle" font-family="Arial, sans-serif" font-size="${kind === "video" ? 70 : 42}" font-weight="700" fill="#fff">${escapeXml(palette.icon)}</text>
<text x="88" y="300" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="${palette.fg}">${escapeXml(title)}</text>
<text x="88" y="360" font-family="Arial, sans-serif" font-size="30" fill="${palette.fg}" opacity=".82">${escapeXml(subtitle)}</text>
<text x="88" y="552" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="${palette.accent}">DEMO Povodeň - Středočeský kraj</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isFloodDemoReportSeedCurrent(
  report: CommunityReportRecord,
  seed: { properties: Record<string, unknown> }
): boolean {
  return (
    report.properties.demoScenarioId === seed.properties.demoScenarioId &&
    report.properties.eventId === seed.properties.eventId &&
    report.properties.groupId === seed.properties.groupId &&
    report.properties.groupName === seed.properties.groupName &&
    report.properties.hazardSeverity === seed.properties.hazardSeverity &&
    report.properties.recommendedAction === seed.properties.recommendedAction
  );
}

function floodDemoDrawingSeeds(groupId: string): Array<Omit<CreateSketchDrawingInput, "actor">> {
  return [
    {
      eventId: floodDemoEventId,
      geometry: {
        coordinates: [
          [
            [14.245, 50.195],
            [14.49, 50.215],
            [14.56, 50.08],
            [14.36, 49.99],
            [14.18, 50.06],
            [14.245, 50.195]
          ]
        ],
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

async function resolveCommunityGroupMemberIdentity(
  member: {
    displayName: string;
    role: CommunityGroupMemberRole;
    status: CommunityGroupMemberStatus;
    subjectId: string;
    username: string;
  },
  directory: {
    readProfile: (subjectId: string) => Promise<UserProfileRecord | null>;
    searchProfiles: (query: string, limit?: number) => Promise<UserProfileRecord[]>;
  }
): Promise<
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
      error:
        "Community group member must resolve to a known COP user profile. Sign in as that user once or use the user search endpoint before adding the member."
    };
  }

  return {
    member,
    resolution: "canonical"
  };
}

async function resolveProfileByHandle(
  handle: string,
  directory: {
    searchProfiles: (query: string, limit?: number) => Promise<UserProfileRecord[]>;
  }
): Promise<UserProfileRecord | null> {
  const normalized = handle.trim().toLowerCase();
  const matches = (await directory.searchProfiles(handle, 10)).filter(
    (profile) =>
      profile.username.toLowerCase() === normalized ||
      profile.email?.toLowerCase() === normalized ||
      profile.displayName.toLowerCase() === normalized
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
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
    ...(normalizeCommunityLocation(value.anchorLocation, "manual")
      ? { anchorLocation: normalizeCommunityLocation(value.anchorLocation, "manual") }
      : {}),
    ...(optionalTrimmedString(value.description, 500)
      ? { description: optionalTrimmedString(value.description, 500) }
      : {}),
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

function normalizeSketchDrawingQuery(
  value: unknown,
  actor: AuthenticatedActor | null,
  actorGroupIds: Set<string>
): SketchDrawingQuery | null {
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

function normalizeCreateSketchDrawingRequest(
  value: unknown,
  actor: AuthenticatedActor
): CreateSketchDrawingInput | null {
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
  const groupId = hasOwn(value, "groupId") ? (optionalUuid(value.groupId) ?? null) : undefined;
  const eventId = hasOwn(value, "eventId") ? (optionalTrimmedString(value.eventId, 160) ?? null) : undefined;
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
  return value === "arrow" ||
    value === "circle" ||
    value === "line" ||
    value === "marker" ||
    value === "measurement" ||
    value === "point" ||
    value === "polygon" ||
    value === "text"
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
      const closed =
        first && last && first[0] === last[0] && first[1] === last[1]
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

function normalizeCoordinateList(
  value: unknown,
  minLength: number,
  maxLength: number
): Array<[number, number]> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const coordinates = value
    .flatMap((item) => {
      const coordinate = normalizeCoordinate(item);
      return coordinate ? [coordinate] : [];
    })
    .slice(0, maxLength);
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
    ...(optionalFiniteNumber(value.lineWidth, 1, 12) !== undefined
      ? { lineWidth: optionalFiniteNumber(value.lineWidth, 1, 12) }
      : {}),
    ...(optionalFiniteNumber(value.opacity, 0.05, 1) !== undefined
      ? { opacity: optionalFiniteNumber(value.opacity, 0.05, 1) }
      : {}),
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

function canReadSketchDrawingResponse(
  drawing: SketchDrawingFeature,
  actor: AuthenticatedActor | null,
  actorGroupIds: Set<string>
): boolean {
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
  "avatarMediaId",
  "avatarUrl",
  "canonicalKey",
  "classification",
  "conversationKind",
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
  const type = value.type === "direct" ? "direct" : "group";
  const requestedKind = optionalTrimmedString(value.conversationKind ?? metadata?.conversationKind, 32);
  const conversationKind =
    requestedKind === "personal_ai"
      ? "personal_ai"
      : requestedKind === "direct" || requestedKind === "group"
        ? requestedKind
        : type;
  if (
    (conversationKind === "personal_ai" && type !== "direct") ||
    (conversationKind === "direct" && type !== "direct") ||
    (conversationKind === "group" && type !== "group")
  ) {
    return null;
  }
  return {
    ...(normalizeMessagingAvatarUrl(value.avatarUrl)
      ? { avatarUrl: normalizeMessagingAvatarUrl(value.avatarUrl) }
      : {}),
    conversationKind,
    ...(mapLinks ? { mapLinks } : {}),
    ...(members ? { members } : {}),
    ...(metadata ? { metadata } : {}),
    title,
    type
  };
}

function normalizeMatrixDeviceId(value: unknown): string | undefined {
  const deviceId = optionalTrimmedString(value, 64);
  return deviceId && /^[A-Za-z0-9._=-]{1,64}$/u.test(deviceId) ? deviceId : undefined;
}

function normalizeMessagingE2eeResetAuthRequest(value: unknown): MessagingE2eeResetAuthRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const allowedFields = new Set(["deviceId", "masterKey", "selfSigningKey", "userSigningKey"]);
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    return null;
  }
  const deviceId = normalizeMatrixDeviceId(value.deviceId);
  const masterKey = normalizeMatrixCrossSigningPublicKey(value.masterKey, "master");
  const selfSigningKey = normalizeMatrixCrossSigningPublicKey(value.selfSigningKey, "self_signing");
  const userSigningKey = normalizeMatrixCrossSigningPublicKey(value.userSigningKey, "user_signing");
  if (
    !deviceId ||
    !masterKey ||
    !selfSigningKey ||
    !userSigningKey ||
    masterKey.user_id !== selfSigningKey.user_id ||
    masterKey.user_id !== userSigningKey.user_id
  ) {
    return null;
  }
  return { deviceId, masterKey, selfSigningKey, userSigningKey };
}

function normalizeMatrixCrossSigningPublicKey(
  value: unknown,
  expectedUsage: "master" | "self_signing" | "user_signing"
): MessagingE2eeResetAuthRequest["masterKey"] | null {
  if (!isRecord(value)) {
    return null;
  }
  const allowedFields = new Set(["keys", "signatures", "usage", "user_id"]);
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    return null;
  }
  const userId = optionalTrimmedString(value.user_id, 255);
  const usage = Array.isArray(value.usage) ? value.usage : [];
  const keys = normalizeMatrixPublicKeyMap(value.keys, 4);
  const signatures = value.signatures === undefined ? undefined : normalizeMatrixSignatureMap(value.signatures);
  if (
    !userId ||
    !/^@[^:\s]{1,180}:[^\s]{1,180}$/u.test(userId) ||
    usage.length !== 1 ||
    usage[0] !== expectedUsage ||
    !keys ||
    (value.signatures !== undefined && !signatures)
  ) {
    return null;
  }
  return {
    keys,
    ...(signatures ? { signatures } : {}),
    usage: [expectedUsage],
    user_id: userId
  };
}

function normalizeMatrixPublicKeyMap(value: unknown, maxEntries: number): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > maxEntries) {
    return null;
  }
  const normalized: Record<string, string> = {};
  for (const [keyId, publicValue] of entries) {
    if (
      !/^ed25519:[A-Za-z0-9._=+\/-]{1,192}$/u.test(keyId) ||
      typeof publicValue !== "string" ||
      !/^[A-Za-z0-9._=+\/-]{16,1024}$/u.test(publicValue)
    ) {
      return null;
    }
    normalized[keyId] = publicValue;
  }
  return normalized;
}

function normalizeMatrixSignatureMap(value: unknown): Record<string, Record<string, string>> | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.length > 8) {
    return null;
  }
  const normalized: Record<string, Record<string, string>> = {};
  for (const [userId, signatures] of entries) {
    if (!/^@[^:\s]{1,180}:[^\s]{1,180}$/u.test(userId)) {
      return null;
    }
    const normalizedSignatures = normalizeMatrixPublicKeyMap(signatures, 16);
    if (!normalizedSignatures) {
      return null;
    }
    normalized[userId] = normalizedSignatures;
  }
  return normalized;
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
  const capabilities = Array.from(
    new Set(
      value
        .map((item) => optionalTrimmedString(item, 64))
        .filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9_.:-]{1,64}$/u.test(item))
    )
  ).slice(0, 20);
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

function normalizeMessagingVoiceCallWakeRequest(
  value: unknown
): { action: "ended" | "invite"; callId: string; participantUserIds?: string[]; roomId: string } | null {
  if (!isRecord(value)) {
    return null;
  }
  const action = value.action === "invite" || value.action === "ended" ? value.action : undefined;
  const callId = optionalTrimmedString(value.callId, 160);
  const roomId = normalizeMatrixRoomId(value.roomId);
  const rawParticipantUserIds = value.participantUserIds;
  const participantUserIds = Array.isArray(rawParticipantUserIds)
    ? rawParticipantUserIds.map((item) => optionalTrimmedString(item, 160))
    : undefined;
  const validParticipantSubset =
    rawParticipantUserIds === undefined ||
    (action === "invite" &&
      Array.isArray(rawParticipantUserIds) &&
      rawParticipantUserIds.length >= 1 &&
      rawParticipantUserIds.length <= 5 &&
      participantUserIds?.every((item): item is string => Boolean(item)) &&
      new Set(participantUserIds).size === participantUserIds.length);
  if (!action || !callId || !roomId || !/^[A-Za-z0-9._:=@-]{1,160}$/u.test(callId) || !validParticipantSubset) {
    return null;
  }
  return {
    action,
    callId,
    ...(participantUserIds?.length ? { participantUserIds: participantUserIds as string[] } : {}),
    roomId
  };
}

function voiceCallWakeIdempotencyKey(
  subjectId: string,
  wake: { action: "ended" | "invite"; callId: string; participantUserIds?: string[]; roomId: string }
): string {
  const digest = createHash("sha256")
    .update(
      `${subjectId}\0${wake.roomId}\0${wake.callId}\0${wake.action}\0${[...(wake.participantUserIds ?? [])].sort().join(",")}`
    )
    .digest("hex")
    .slice(0, 48);
  return `voice-call:${wake.action}:${digest}`;
}

function normalizeMatrixIdentityResolutionRequest(value: unknown): string[] | null {
  if (!isRecord(value) || containsMessagingPlaintextKey(value) || !Array.isArray(value.userIds)) {
    return null;
  }
  const userIds = Array.from(
    new Set(
      value.userIds
        .map((item) => optionalTrimmedString(item, 160))
        .filter((item): item is string => Boolean(item))
        .slice(0, 100)
    )
  );
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
  const roomId = value.roomId === undefined ? undefined : normalizeMatrixRoomId(value.roomId);
  if (value.roomId !== undefined && !roomId) {
    return null;
  }
  return {
    ...(typeof value.encrypted === "boolean" ? { encrypted: value.encrypted } : {}),
    ...(roomId ? { roomId } : {})
  };
}

function containsMessagingPlaintextKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsMessagingPlaintextKey);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(
    ([key, nested]) =>
      messagingPlaintextKeys.has(key) ||
      messagingPlaintextKeys.has(key.toLowerCase()) ||
      containsMessagingPlaintextKey(nested)
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
      ? [
          {
            ...(normalizeMessagingAvatarUrl(item.avatarUrl ?? item.avatar_url)
              ? { avatarUrl: normalizeMessagingAvatarUrl(item.avatarUrl ?? item.avatar_url) }
              : {}),
            ...(optionalTrimmedString(item.displayName, 160)
              ? { displayName: optionalTrimmedString(item.displayName, 160) }
              : {}),
            ...(optionalTrimmedString(item.role, 32) ? { role: optionalTrimmedString(item.role, 32) } : {}),
            userId
          }
        ]
      : [];
  });
  return members.length ? members.slice(0, 100) : undefined;
}

function normalizeMessagingAvatarUrl(value: unknown): string | undefined {
  const avatarUrl = optionalTrimmedString(value, 4096);
  if (!avatarUrl) {
    return undefined;
  }
  if (avatarUrl.startsWith("mxc://") || avatarUrl.startsWith("data:image/")) {
    return avatarUrl;
  }
  try {
    const url = new URL(avatarUrl);
    return url.protocol === "https:" ? avatarUrl : undefined;
  } catch {
    return undefined;
  }
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
    const bbox =
      Array.isArray(item.bbox) && item.bbox.length === 4
        ? item.bbox.flatMap((coordinate) =>
            typeof coordinate === "number" && Number.isFinite(coordinate) ? [coordinate] : []
          )
        : undefined;
    return [
      {
        ...(bbox?.length === 4 ? { bbox } : {}),
        ...(optionalTrimmedString(item.label, 160) ? { label: optionalTrimmedString(item.label, 160) } : {}),
        ...(optionalTrimmedString(item.layerId, 160) ? { layerId: optionalTrimmedString(item.layerId, 160) } : {}),
        targetId
      }
    ];
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

function normalizeMessagingMetadataValue(
  value: unknown
): string | number | boolean | null | Array<string | number | boolean | null> | undefined {
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
  const byteSize = optionalFiniteNumber(
    value.byteSize,
    1,
    readPositiveInteger(process.env.COP_MEDIA_MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024)
  );
  const kind = isCommunityAttachmentKind(value.kind)
    ? value.kind
    : contentType
      ? kindFromContentType(contentType)
      : undefined;
  if (!contentType || byteSize === undefined || !kind || !isAllowedCommunityContentType(contentType, kind)) {
    return null;
  }
  return {
    byteSize,
    ...(optionalIsoTimestamp(value.capturedAt) ? { capturedAt: optionalIsoTimestamp(value.capturedAt) } : {}),
    ...(normalizeCommunityLocation(value.captureLocation, "photo_exif")
      ? { captureLocation: normalizeCommunityLocation(value.captureLocation, "photo_exif") }
      : {}),
    ...(optionalChecksumSha256(value.checksumSha256)
      ? { checksumSha256: optionalChecksumSha256(value.checksumSha256) }
      : {}),
    contentType,
    ...(optionalTrimmedString(value.fileName, 160) ? { fileName: optionalTrimmedString(value.fileName, 160) } : {}),
    kind,
    metadata: normalizedJsonRecord(value.metadata, 4000)
  };
}

function normalizeCommunityAttachmentUploadBody(
  value: unknown,
  declaredByteSize: number,
  maxByteSize: number
): { body: Buffer } | null {
  if (Buffer.isBuffer(value)) {
    if (value.length < 1 || value.length > maxByteSize || value.length !== declaredByteSize) {
      return null;
    }
    return { body: value };
  }
  if (!isRecord(value)) {
    return null;
  }
  const rawData =
    typeof value.dataBase64 === "string"
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
  return (
    group.visibility === "public" ||
    group.members.some(
      (member) => member.subjectId === actor.subjectId && (member.status === "active" || member.status === "pending")
    )
  );
}

function canUseCommunityGroupForReport(group: CommunityGroupRecord, actor: AuthenticatedActor): boolean {
  return group.members.some((member) => member.subjectId === actor.subjectId && member.status === "active");
}

function communityReportGroupId(
  report: Pick<CommunityReportRecord, "properties"> | { properties?: Record<string, unknown> }
): string | undefined {
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

function communityAttachmentAccessPolicy(attachment: {
  metadata?: Record<string, unknown>;
}): CommunityAttachmentAccessPolicy {
  const access = isRecord(attachment.metadata?.access) ? attachment.metadata.access : {};
  const mode = isCommunityAttachmentAccessMode(access.audience)
    ? access.audience
    : isCommunityAttachmentAccessMode(access.mode)
      ? access.mode
      : "public";
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
  const demoContentUrl = communityAttachmentDemoContentUrl(attachment);
  return {
    ...attachment,
    ...communityAttachmentDerivativeResponse(attachment, reportId, canReadMedia, actor, requestNow),
    ...(attachment.status === "uploaded" && canReadMedia
      ? {
          contentUrl:
            demoContentUrl ?? communityAttachmentContentUrl(reportId, attachment.attachmentId, actor, requestNow)
        }
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
    derivatives: [
      {
        ...(typeof derivative.byteSize === "number" ? { byteSize: derivative.byteSize } : {}),
        ...(derivative.contentType ? { contentType: derivative.contentType } : {}),
        ...(canReadMedia && derivative.status === "ready"
          ? {
              contentUrl: communityAttachmentDerivativeContentUrl(
                reportId,
                attachment.attachmentId,
                derivative.derivativeId,
                actor,
                requestNow
              )
            }
          : {}),
        derivativeId: derivative.derivativeId,
        ...(derivative.error ? { error: derivative.error } : {}),
        kind: "video",
        layout: derivative.layout,
        status: derivative.status,
        updatedAt: derivative.updatedAt
      }
    ]
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
  return (
    payload.v === 1 &&
    payload.exp >= nowSeconds &&
    payload.reportId === expected.reportId &&
    payload.attachmentId === expected.attachmentId &&
    (payload.derivativeId ?? "") === (expected.derivativeId ?? "")
  );
}

function parseCommunityMediaTicketPayload(encodedPayload: string): CommunityMediaTicketPayload | null {
  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.v !== 1 ||
      typeof parsed.exp !== "number" ||
      typeof parsed.reportId !== "string" ||
      typeof parsed.attachmentId !== "string" ||
      (hasOwn(parsed, "derivativeId") && typeof parsed.derivativeId !== "string")
    ) {
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
  return process.env.COP_MEDIA_ACCESS_TOKEN_SECRET ?? process.env.COP_LAB_TOKEN ?? "dev-community-media-ticket-secret";
}

function base64UrlEncode(value: Buffer): string {
  return value.toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Buffer {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
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
        confidence: report.location.accuracyM
          ? Math.max(0.35, Math.min(0.95, 1 - report.location.accuracyM / 1000))
          : 0.7,
        description: report.description ?? null,
        documentCount: report.attachments.filter(
          (attachment) => attachment.kind === "document" && attachment.status === "uploaded"
        ).length,
        featureId: `community:${report.reportId}`,
        groupId: typeof report.properties.groupId === "string" ? report.properties.groupId : null,
        groupName: typeof report.properties.groupName === "string" ? report.properties.groupName : null,
        hazardSeverity: communityReportSeverity(report),
        label: report.title,
        layer: "community",
        locationAccuracyM: report.location.accuracyM ?? null,
        observedAt: report.observedAt,
        photoCount: report.attachments.filter(
          (attachment) => attachment.kind === "photo" && attachment.status === "uploaded"
        ).length,
        reportId: report.reportId,
        severity: communityReportSeverity(report),
        sourceId: "community_reports",
        status: report.status,
        stale: isCommunityReportStale(report, requestNow),
        validUntil: communityReportValidUntil(report) ?? null,
        videoCount: report.attachments.filter(
          (attachment) => attachment.kind === "video" && attachment.status === "uploaded"
        ).length,
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

function communityAttachmentDemoContentUrl(attachment: { metadata?: Record<string, unknown> }): string | undefined {
  const metadata = attachment.metadata ?? {};
  const value = metadata.demoContentUrl ?? metadata.contentUrl;
  return typeof value === "string" && /^(data:|\/api\/v1\/community\/|https:\/\/)/u.test(value) ? value : undefined;
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
      const demoContentUrl = communityAttachmentDemoContentUrl(attachment);
      return {
        access: communityAttachmentAccessSummary(attachment),
        ...(canReadMedia ? {} : { accessDenied: true }),
        attachmentId: attachment.attachmentId,
        byteSize: attachment.byteSize,
        contentType: attachment.contentType,
        ...(canReadMedia
          ? {
              contentUrl:
                typeof existingContentUrl === "string" && existingContentUrl
                  ? existingContentUrl
                  : demoContentUrl
                    ? demoContentUrl
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

function normalizeCreateIncidentTaskRequest(
  incidentId: string,
  value: unknown,
  actor: AuthenticatedActor
): CreateIncidentTaskInput | null {
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

function normalizeIncidentLocation(
  value: unknown,
  fallbackSource: IncidentLocationSource
): IncidentLocation | undefined {
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
  return Array.from(new Set(items.flatMap((item) => (typeof item === "string" ? [item.trim()] : [])).filter(Boolean)));
}

function normalizeCommunityLocation(
  value: unknown,
  fallbackSource: CommunityLocationSource
): CommunityReportLocation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const lat = optionalFiniteNumber(value.lat, -90, 90);
  const lon = optionalFiniteNumber(value.lon, -180, 180);
  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  return {
    ...(optionalFiniteNumber(value.accuracyM, 0, 100000) !== undefined
      ? { accuracyM: optionalFiniteNumber(value.accuracyM, 0, 100000) }
      : {}),
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
  if (
    category === "bridge_damage" ||
    category === "road_blockage" ||
    category === "infrastructure_damage" ||
    category === "hazard"
  ) {
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
  return (
    value === "fire" ||
    value === "flood" ||
    value === "bridge_damage" ||
    value === "road_blockage" ||
    value === "infrastructure_damage" ||
    value === "medical" ||
    value === "utility_outage" ||
    value === "hazard" ||
    value === "other"
  );
}

function isIncidentCategory(value: unknown): value is IncidentCategory {
  return (
    value === "community" ||
    value === "fire" ||
    value === "flood" ||
    value === "infrastructure" ||
    value === "medical" ||
    value === "other" ||
    value === "security" ||
    value === "traffic" ||
    value === "weather"
  );
}

function isIncidentSeverity(value: unknown): value is IncidentSeverity {
  return value === "advisory" || value === "critical" || value === "info" || value === "warning";
}

function isIncidentStatus(value: unknown): value is IncidentStatus {
  return (
    value === "active" ||
    value === "candidate" ||
    value === "closed" ||
    value === "monitoring" ||
    value === "rejected" ||
    value === "resolved"
  );
}

function isIncidentLocationSource(value: unknown): value is IncidentLocationSource {
  return value === "community_report" || value === "fusion" || value === "manual" || value === "provider";
}

function isIncidentSourceRefKind(value: unknown): value is IncidentSourceRefKind {
  return (
    value === "alert" ||
    value === "community_report" ||
    value === "manual" ||
    value === "provider_feature" ||
    value === "sketch"
  );
}

function isIncidentTaskPriority(value: unknown): value is IncidentTaskPriority {
  return value === "high" || value === "low" || value === "normal" || value === "urgent";
}

function isIncidentTaskStatus(value: unknown): value is IncidentTaskStatus {
  return (
    value === "blocked" || value === "cancelled" || value === "done" || value === "in_progress" || value === "open"
  );
}

function isCommunityReportStatus(value: unknown): value is CommunityReportStatus {
  return (
    value === "draft" || value === "submitted" || value === "published" || value === "hidden" || value === "rejected"
  );
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
  return value === "active" || value === "left" || value === "pending";
}

function isCommunityAttachmentAccessMode(value: unknown): value is CommunityAttachmentAccessMode {
  return value === "public" || value === "private" || value === "users" || value === "groups";
}

function isCommunityLocationSource(value: unknown): value is CommunityLocationSource {
  return (
    value === "device" ||
    value === "manual" ||
    value === "media_metadata" ||
    value === "photo_exif" ||
    value === "unknown"
  );
}

function isCommunityAttachmentKind(value: unknown): value is CommunityAttachmentKind {
  return value === "photo" || value === "video" || value === "document";
}

function contentDispositionHeader(value: string): string {
  const fileName = sanitizeContentDispositionFileName(value);
  const fallback =
    fileName
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
): MobileDeviceRegistrationInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const deviceId = normalizeMobileDeviceId(value.deviceId);
  const appVersion = optionalTrimmedString(value.appVersion, 40);
  const platform = isMobilePlatform(value.platform) ? value.platform : undefined;
  if (!deviceId || !appVersion || !platform) {
    return null;
  }
  const pushToken = optionalTrimmedString(value.pushToken, 4096);
  return {
    appVersion,
    ...(optionalTrimmedString(value.buildNumber, 40)
      ? { buildNumber: optionalTrimmedString(value.buildNumber, 40) }
      : {}),
    capabilities: normalizeStringList(value.capabilities, 16, 80),
    deviceId,
    ...(optionalTrimmedString(value.deviceModel, 80)
      ? { deviceModel: optionalTrimmedString(value.deviceModel, 80) }
      : {}),
    deviceSessionId: crypto.randomUUID(),
    ...(optionalTrimmedString(value.osVersion, 40) ? { osVersion: optionalTrimmedString(value.osVersion, 40) } : {}),
    platform,
    pushTokenRegistered: Boolean(pushToken),
    registeredAt: registeredAt.toISOString(),
    subjectId: actor.subjectId
  };
}

function normalizeMobileDeviceId(value: unknown): string | undefined {
  const deviceId = optionalTrimmedString(value, 160);
  return deviceId && /^[A-Za-z0-9_.:=@-]{1,160}$/u.test(deviceId) ? deviceId : undefined;
}

function normalizeMobilePairingCode(value: unknown): string | undefined {
  const code = optionalTrimmedString(value, 96);
  return code && /^[A-Za-z0-9_-]{16,96}$/u.test(code) ? code : undefined;
}

function normalizeMobilePairingTtlSeconds(value: unknown): number {
  const raw = isRecord(value) ? value.ttlSeconds : undefined;
  const parsed = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 600;
  return Math.min(900, Math.max(60, parsed));
}

function normalizeMobileMeshBundle(
  value: unknown,
  actor: AuthenticatedActor,
  receivedAt: Date
): { envelopeId?: string; reason: string; valid: false } | { input: MobileMeshBundleIngestInput; valid: true } {
  if (!isRecord(value)) {
    return { reason: "payload_not_object", valid: false };
  }
  const envelope = isRecord(value.envelope) ? value.envelope : value;
  const contractVersion =
    optionalTrimmedString(value.contractVersion, 80) ?? optionalTrimmedString(envelope.contractVersion, 80);
  const envelopeId = normalizeMobileMeshEnvelopeId(value.envelopeId ?? value.id ?? envelope.envelopeId ?? envelope.id);
  const encrypted =
    value.encrypted === true ||
    envelope.encrypted === true ||
    optionalTrimmedString(value.ciphertext, 12000) !== undefined ||
    optionalTrimmedString(envelope.ciphertext, 12000) !== undefined ||
    (isRecord(value.payload) && value.payload.encrypted === true);
  const signed =
    optionalTrimmedString(value.signature, 4096) !== undefined ||
    optionalTrimmedString(envelope.signature, 4096) !== undefined ||
    (Array.isArray(value.signatures) && value.signatures.length > 0) ||
    (Array.isArray(envelope.signatures) && envelope.signatures.length > 0);
  if (contractVersion !== "csm-mesh-v1") {
    return { envelopeId, reason: "unsupported_contract_version", valid: false };
  }
  if (!envelopeId) {
    return { reason: "missing_envelope_id", valid: false };
  }
  if (!encrypted || !signed) {
    return { envelopeId, reason: "bundle_must_be_encrypted_and_signed", valid: false };
  }
  const bundleType = normalizeMobileMeshBundleType(
    value.type ?? value.payloadType ?? envelope.type ?? envelope.payloadType
  );
  const deviceId = normalizeMobileDeviceId(value.deviceId ?? envelope.deviceId);
  const expiresAt = optionalIsoDateString(value.expiresAt ?? envelope.expiresAt);
  const payloadSizeBytes = mobileMeshPayloadSizeBytes(value);
  return {
    input: {
      ...(bundleType ? { bundleType } : {}),
      ...(deviceId ? { deviceId } : {}),
      envelopeId,
      ...(expiresAt ? { expiresAt } : {}),
      ...(payloadSizeBytes !== undefined ? { payloadSizeBytes } : {}),
      receivedAt: receivedAt.toISOString(),
      subjectId: actor.subjectId
    },
    valid: true
  };
}

function normalizeMobileMeshEnvelopeId(value: unknown): string | undefined {
  const envelopeId = optionalTrimmedString(value, 160);
  return envelopeId && /^[A-Za-z0-9_.:=@-]{8,160}$/u.test(envelopeId) ? envelopeId : undefined;
}

function normalizeMobileMeshBundleType(value: unknown): string | undefined {
  const type = optionalTrimmedString(value, 40);
  return type && ["text", "location", "control", "image", "manifest"].includes(type) ? type : undefined;
}

function mobileMeshPayloadSizeBytes(value: Record<string, unknown>): number | undefined {
  const explicit = value.payloadSizeBytes;
  if (typeof explicit === "number" && Number.isInteger(explicit) && explicit >= 0 && explicit <= 2_000_000) {
    return explicit;
  }
  const ciphertext = optionalTrimmedString(value.ciphertext, 2_000_000);
  return ciphertext ? ciphertext.length : undefined;
}

function mobileMeshAckResponse(ack: MobileMeshAckRecord) {
  return {
    ack,
    contractVersion: "cop-mobile-mesh-acks-v1",
    security: {
      containsPlaintext: false,
      serverDecrypted: false
    },
    serverTimestamp: new Date().toISOString()
  };
}

function mobilePairingActor(actor: AuthenticatedActor): MobilePairingActorRecord {
  return {
    displayName: actor.displayName,
    subjectId: actor.subjectId,
    username: actor.username
  };
}

function canViewMobilePairingSession(actor: AuthenticatedActor, session: MobilePairingSessionRecord): boolean {
  return session.createdBy.subjectId === actor.subjectId || session.claimedBy?.subjectId === actor.subjectId;
}

function mobilePairingSessionResponse(
  session: MobilePairingSessionRecord,
  request: FastifyRequest,
  device?: MobileDeviceRecord
) {
  const publicBaseUrl = publicCopBaseUrl(request);
  const scheme = mobileAuthConfig().redirectUriScheme;
  return {
    contractVersion: "cop-mobile-pairing-v1",
    device: device ?? null,
    pairing: {
      claimedAt: session.claimedAt ?? null,
      claimedBy: session.claimedBy ?? null,
      claimedDevice: session.claimedDevice
        ? {
            appVersion: session.claimedDevice.appVersion,
            buildNumber: session.claimedDevice.buildNumber ?? null,
            capabilities: session.claimedDevice.capabilities,
            deviceId: session.claimedDevice.deviceId,
            deviceModel: session.claimedDevice.deviceModel ?? null,
            matrixDeviceId: session.claimedDevice.matrixDeviceId ?? null,
            osVersion: session.claimedDevice.osVersion ?? null,
            platform: session.claimedDevice.platform,
            pushTokenRegistered: session.claimedDevice.pushTokenRegistered
          }
        : null,
      code: session.code,
      confirmedAt: session.confirmedAt ?? null,
      createdAt: session.createdAt,
      createdBy: session.createdBy,
      expiresAt: session.expiresAt,
      links: {
        customSchemeUrl: `${scheme}://pair?code=${encodeURIComponent(session.code)}`,
        universalLink: `${publicBaseUrl}/mobile/pair/${encodeURIComponent(session.code)}`
      },
      status: session.status
    },
    policy: mobileNativePolicy(),
    security: {
      containsAccessToken: false,
      containsRecoveryKey: false,
      containsRoomKeys: false,
      confirmationRequired: true
    },
    serverTimestamp: new Date().toISOString()
  };
}

function appleAppSiteAssociation(env: Record<string, string | undefined> = process.env) {
  const appId = env.COP_IOS_APP_ID ?? "LM6W548X36.cz.zeleznalady.csm.messenger";
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [appId],
          components: [
            {
              "/": "/mobile/pair/*",
              comment: "CSM Messenger pairing links"
            }
          ],
          paths: ["/mobile/pair/*"]
        }
      ]
    },
    webcredentials: {
      apps: [appId]
    }
  };
}

function mobilePairFallbackHtml(code: string, invalid: boolean): string {
  const safeCode = escapeHtml(code);
  const deepLink = code ? `csm://pair?code=${encodeURIComponent(code)}` : "csm://";
  const safeDeepLink = escapeHtml(deepLink);
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CSM Messenger párování</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #071016; color: #f4f7fb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(520px, calc(100vw - 32px)); border: 1px solid rgba(140,182,216,.34); background: linear-gradient(180deg, rgba(17,25,31,.96), rgba(7,12,16,.96)); padding: 28px; box-shadow: 0 28px 80px rgba(0,0,0,.42); }
    h1 { margin: 0 0 10px; font-size: 28px; }
    p { color: #b8c4cf; line-height: 1.5; }
    code { display: block; padding: 12px; background: rgba(255,255,255,.08); color: #c8f08d; overflow-wrap: anywhere; }
    a { display: inline-grid; place-items: center; min-height: 44px; margin-top: 18px; padding: 0 18px; background: #c8f08d; color: #0f151b; font-weight: 900; text-decoration: none; }
    .warning { color: #ffd3c8; }
  </style>
</head>
<body>
  <main>
    <h1>CSM Messenger</h1>
    ${invalid ? '<p class="warning">Pairing odkaz není platný. Vytvořte ve webovém COP nový QR kód.</p>' : `<p>Otevřete párování v aplikaci CSM Messenger. Odkaz obsahuje pouze krátkodobý kód, nikoli přístupový token ani šifrovací klíče.</p><code>${safeCode}</code><a href="${safeDeepLink}">Otevřít v aplikaci</a>`}
    <p>Pokud se aplikace neotevře, nainstalujte aktuální build CSM Messenger a poté zkuste odkaz znovu.</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function publicCopBaseUrl(request: FastifyRequest): string {
  const configured = process.env.COP_PUBLIC_URL ?? process.env.COP_PUBLIC_API_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/u, "");
  }
  const forwardedProto = Array.isArray(request.headers["x-forwarded-proto"])
    ? request.headers["x-forwarded-proto"][0]
    : request.headers["x-forwarded-proto"];
  const forwardedHost = Array.isArray(request.headers["x-forwarded-host"])
    ? request.headers["x-forwarded-host"][0]
    : request.headers["x-forwarded-host"];
  const hostHeader = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host;
  const host = forwardedHost ?? hostHeader ?? "localhost:4310";
  const proto = forwardedProto ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`.replace(/\/+$/u, "");
}

function mobileAuthConfig(env: Record<string, string | undefined> = process.env) {
  const issuer = env.COP_OIDC_ISSUER ?? "";
  return {
    clientId: env.COP_OIDC_CLIENT_ID ?? "cop-web",
    issuer: issuer || null,
    mode: env.COP_AUTH_MODE === "oidc" || env.COP_AUTH_MODE === "hybrid" ? env.COP_AUTH_MODE : "lab",
    redirectUriScheme: env.COP_MOBILE_REDIRECT_SCHEME ?? "csm",
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
    deviceManagement: true,
    devicePairing: true,
    deviceRegistration: true,
    incidentFusionSuggestions: true,
    incidentTasks: true,
    incidents: true,
    offlineSnapshot: true,
    pushNotifications: false,
    safetyContext: true,
    serverUserProfile: true,
    messagingMatrixRoomEnsure: true,
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
    communityReportAttachmentDerivativeContent:
      "/api/v1/community/reports/{reportId}/attachments/{attachmentId}/derivatives/{derivativeId}/content",
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
    messagingMatrixRoomEnsure: "/api/v1/messaging/conversations/{conversationId}/matrix-room",
    mobileDeviceRevoke: "/api/v1/mobile/devices/{deviceId}",
    mobileDevices: "/api/v1/mobile/devices",
    mobileMeshAcks: "/api/v1/mobile/mesh/acks",
    mobileMeshIngest: "/api/v1/mobile/mesh/ingest",
    mobilePairingClaim: "/api/v1/mobile/pairing/sessions/{code}/claim",
    mobilePairingConfirm: "/api/v1/mobile/pairing/sessions/{code}/confirm",
    mobilePairingCreate: "/api/v1/mobile/pairing/sessions",
    mobilePairingStatus: "/api/v1/mobile/pairing/sessions/{code}",
    mobilePairUniversalLink: "/mobile/pair/{code}",
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
    .flatMap((item) => (typeof item === "string" ? [item.trim().slice(0, maxLength)] : []))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseCoordinatePair(value: string | undefined, fallback: [number, number]): [number, number] {
  const [lonRaw, latRaw] = (value ?? "").split(",");
  const lon = Number(lonRaw);
  const lat = Number(latRaw);
  return Number.isFinite(lon) && Number.isFinite(lat)
    ? [clampNumber(lon, -180, 180), clampNumber(lat, -90, 90)]
    : fallback;
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
    selectedLayer: optionalString(value.selectedLayer, [
      "air-situation",
      "sim-air",
      "uav",
      "friendly",
      "foreign",
      "public-flights",
      "data-quality"
    ]),
    showAlertAreas: optionalBoolean(value.showAlertAreas),
    showHistory: optionalBoolean(value.showHistory),
    showPrediction: optionalBoolean(value.showPrediction),
    safetyLayerIds: optionalStringArray(value.safetyLayerIds, [
      "boundary_admin",
      "fire",
      "flood",
      "warnings",
      "weather_alerts"
    ]),
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
    trackLayerIds: optionalStringArray(value.trackLayerIds, [
      "air-situation",
      "sim-air",
      "uav",
      "friendly",
      "foreign",
      "public-flights",
      "data-quality"
    ]),
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

function optionalIsoDateString(value: unknown): string | undefined {
  const raw = optionalTrimmedString(value, 80);
  if (!raw) {
    return undefined;
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
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
  const points = value
    .flatMap((coordinate): Array<[number, number]> => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) {
        return [];
      }
      const lon = optionalFiniteNumber(coordinate[0], -180, 180);
      const lat = optionalFiniteNumber(coordinate[1], -90, 90);
      return lon === undefined || lat === undefined ? [] : [[lon, lat]];
    })
    .slice(0, 160);
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
    Object.entries(value).filter(
      ([, entry]) => entry !== undefined && entry !== null && !(Array.isArray(entry) && entry.length === 0)
    )
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
  const normalizedPath = value.startsWith("/api/v1/") ? value.slice("/api/v1/".length) : value.replace(/^\/+/, "");
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
  return normalized.includes("webcam") || normalized.includes("camera") || normalized.startsWith("weather/");
}

function isAllowedWeatherCameraUrl(url: URL, env: Record<string, string | undefined> = process.env): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "chmi.cz" || hostname.endsWith(".chmi.cz")) {
    return false;
  }
  const allowedHosts = new Set(
    (env.COP_WEATHER_CAMERA_ALLOWED_HOSTS ?? defaultWeatherCameraAllowedHosts)
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
  return allowedHosts.has(hostname);
}

function isAllowedRasterOverlayUrl(url: URL, env: Record<string, string | undefined> = process.env): boolean {
  const allowedHosts = new Set(
    (env.COP_RASTER_OVERLAY_ALLOWED_HOSTS ?? defaultRasterOverlayAllowedHosts)
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    return false;
  }
  if (!/\.(png|jpg|jpeg|webp)$/iu.test(url.pathname)) {
    return false;
  }
  return true;
}

async function fetchMediaStorageContent(readUrl: string, range?: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(readUrl, {
      headers: range ? { range } : undefined,
      signal: controller.signal
    });
  } finally {
    // Fetch resolves after response headers arrive. The body remains connected to
    // the returned stream and is cancelled automatically when the client closes it.
    clearTimeout(timeout);
  }
}

function readableResponseBody(response: Response): Readable {
  return response.body ? Readable.fromWeb(response.body as unknown as NodeReadableStream) : Readable.from([]);
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

async function fetchWeatherStationDetailResource(url: URL, timeoutMsOverride?: number): Promise<unknown> {
  const timeoutMs = timeoutMsOverride ?? readPositiveInteger(process.env.COP_SITUATION_DATA_TIMEOUT_MS, 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "CSM-COP weather station detail proxy"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`SIM weather station detail returned HTTP ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWeatherForecastAreaDetailResource(url: URL, timeoutMsOverride?: number): Promise<unknown> {
  const timeoutMs = timeoutMsOverride ?? readPositiveInteger(process.env.COP_SITUATION_DATA_TIMEOUT_MS, 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "CSM-COP weather forecast area detail proxy"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`SIM weather forecast area detail returned HTTP ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTransitVehicleDetailResource(url: URL, timeoutMsOverride?: number): Promise<unknown> {
  const timeoutMs = timeoutMsOverride ?? readPositiveInteger(process.env.COP_SITUATION_DATA_TIMEOUT_MS, 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "CSM-COP transit vehicle detail proxy"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`SIM transit vehicle detail returned HTTP ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTransitStopDetailResource(url: URL, timeoutMsOverride?: number): Promise<unknown> {
  const timeoutMs = timeoutMsOverride ?? readPositiveInteger(process.env.COP_SITUATION_DATA_TIMEOUT_MS, 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "CSM-COP transit stop detail proxy"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`SIM transit stop detail returned HTTP ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function optionalTransitSourceId(value: unknown): string | undefined {
  const source = optionalTrimmedString(value, 80);
  if (!source) {
    return undefined;
  }
  return /^[a-z0-9_.:-]+$/iu.test(source) ? source : undefined;
}

function optionalTransitPathId(value: unknown, maxLength: number): string | undefined {
  const id = optionalTrimmedString(value, maxLength);
  if (!id) {
    return undefined;
  }
  return /^[a-z0-9_.:-]+$/iu.test(id) ? id : undefined;
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

function optionalBoundedQueryInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? boundedInteger(Math.trunc(parsed), min, max) : undefined;
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
  return (
    value === "AOI_ENTRY" ||
    value === "LOW_CONFIDENCE" ||
    value === "SOURCE_DEGRADED" ||
    value === "TRACK_CONFLICT" ||
    value === "TRACK_LOST" ||
    value === "TRACK_STALE"
  );
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

function mcpJsonRpcResult(
  id: McpJsonRpcId | undefined,
  result: Record<string, unknown>
): Record<string, unknown> | undefined {
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
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : crypto.randomUUID();
}

function aiLanguage(value: unknown): "cs" | "en" {
  return value === "en" ? "en" : "cs";
}

function aiPlaceQueryFromQuestion(question: string): string | undefined {
  const text = question.replace(/\s+/gu, " ").trim();
  const patterns = [
    /\b(?:ve|v|u|okolo|okolí|poblíž|blízko|kolem|pro)\s+(?<place>[^?.!,;\n]{3,120})/iu,
    /\bsituace\s+(?<place>[^?.!,;\n]{3,120})/iu
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const rawPlace = match?.groups?.place;
    if (!rawPlace) {
      continue;
    }
    const place = rawPlace
      .replace(
        /\b(?:vytvoř|vytvor|udělej|udelej|shrň|shrn|situational|awareness|prosím|prosim|co\b|jaká\b|jaka\b|jaký\b|jaky\b).*$/iu,
        ""
      )
      .trim();
    if (place.length >= 3 && !isAiGenericPlaceQuery(place)) {
      return place.slice(0, 120);
    }
  }
  return undefined;
}

function isAiGenericPlaceQuery(value: string): boolean {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("cs-CZ");
  return /^(cop|chatu?|skupine|mistnosti|aplikaci|kontextu|mape|okoli|okolo|pobliz|blizko|kolem|tady|zde|moje okoli|moji polohy|me polohy|aktualni polohy|nearby|around|near me)$/u.test(
    normalized
  );
}

function aiQuestionUsesImplicitCurrentArea(question: string): boolean {
  const normalized = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("cs-CZ");
  return (
    /\b(v okoli|okoli me|okoli moji polohy|okoli me polohy|pobliz me|pobliz moji polohy|blizko me|blizko moji polohy|kolem me|kolem moji polohy|u me|u moji polohy|moje okoli|near me|nearby|around me|current location)\b/u.test(
      normalized
    ) || /\bv okoli(?:\s*(?:\?|\.|!|,|;|$)|\s+(?:a|nebo|ted|nyni|moji|me|aktualni)\b)/u.test(normalized)
  );
}

function aiModelPreference(value: unknown): AiModelPreference | undefined {
  return value === "fast" || value === "reasoning" || value === "auto" ? value : undefined;
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

interface AiPrioritySignal {
  category?: string;
  citation: string;
  entityId: string;
  entityType:
    "alert" | "chatMessage" | "communityReport" | "incident" | "mapFeature" | "observedObject" | "sourceHealth";
  location?: {
    lat: number;
    lon: number;
  };
  priorityScore: number;
  reason: string;
  severity?: string;
  sourceSystemIds?: string[];
  status?: string;
  title: string;
  updatedAt?: string;
}

function prioritizeObjectsForAi(objects: ObservedObject[]): ObservedObject[] {
  return [...objects].sort(
    (left, right) =>
      aiObservedObjectPriorityScore(right) - aiObservedObjectPriorityScore(left) ||
      timestampMillis(right.lastUpdatedAt) - timestampMillis(left.lastUpdatedAt) ||
      left.objectId.localeCompare(right.objectId)
  );
}

function aiObservedObjectPriorityScore(object: ObservedObject): number {
  const text = `${object.objectType} ${object.domain} ${object.status} ${object.dataQuality ?? ""}`.toLocaleLowerCase(
    "cs-CZ"
  );
  let score = 0;
  if (object.status === "ACTIVE") {
    score += 0.1;
  }
  if (object.status === "LOST") {
    score -= 0.08;
  }
  if (object.domain === "AIR") {
    score -= 0.2;
  }
  if (/(flood|water|fire|hazard|incident|security|police|medical|infrastructure|traffic)/u.test(text)) {
    score += 0.28;
  }
  if (/(stale|track_stale|low_confidence|zastaral)/u.test(text)) {
    score -= 0.2;
  }
  if (object.attributes?.conflictEvidence) {
    score += 0.08;
  }
  return score;
}

function buildAiPriorityContext(input: {
  alerts?: Record<string, unknown>[];
  chatContext?: Record<string, unknown>;
  communityReports?: Record<string, unknown>[];
  incidents?: Record<string, unknown>[];
  mapFeatures?: Record<string, unknown>[];
  objects?: Record<string, unknown>[];
  sourceHealth?: Record<string, unknown>[];
}): Record<string, unknown> {
  const signals = [
    ...(input.incidents ?? []).map((record) => aiPrioritySignalFromRecord("incident", record, "incidentId")),
    ...(input.communityReports ?? []).map((record) =>
      aiPrioritySignalFromRecord("communityReport", record, "reportId")
    ),
    ...(input.alerts ?? []).map((record) => aiPrioritySignalFromRecord("alert", record, "alertId")),
    ...(input.mapFeatures ?? []).map((record) => aiPrioritySignalFromRecord("mapFeature", record, "mapFeatureId")),
    ...(input.objects ?? []).map((record) => aiPrioritySignalFromRecord("observedObject", record, "objectId")),
    ...(input.sourceHealth ?? []).map((record) => aiPrioritySignalFromRecord("sourceHealth", record, "sourceSystemId")),
    ...aiPrioritySignalsFromChat(input.chatContext)
  ]
    .filter((signal): signal is AiPrioritySignal => Boolean(signal))
    .sort(
      (left, right) =>
        right.priorityScore - left.priorityScore || timestampMillis(right.updatedAt) - timestampMillis(left.updatedAt)
    )
    .slice(0, 16)
    .map((signal, index) => ({
      ...signal,
      citation: `P${index + 1}`
    }));
  const mapSnapshotCandidates = signals
    .filter((signal) => signal.location)
    .slice(0, 12)
    .map((signal) =>
      compactRecord({
        category: signal.category,
        citation: signal.citation,
        entityId: signal.entityId,
        entityType: signal.entityType,
        label: signal.title,
        location: signal.location,
        priorityScore: signal.priorityScore,
        severity: signal.severity,
        status: signal.status
      })
    );
  return compactRecord({
    contractVersion: "cop-ai-priority-context-v1",
    focusOrder: [
      "flood-water",
      "fire",
      "medical",
      "infrastructure",
      "traffic-disruption",
      "security-police",
      "community-reports",
      "active-alerts",
      "air-tracks-only-if-relevant"
    ],
    guidance:
      "Treat stale civil air-track diagnostics as low priority unless directly relevant to safety, a user question, or a data-coverage caveat.",
    counts: compactRecord({
      alerts: input.alerts?.length ?? 0,
      chatMessages: Array.isArray(input.chatContext?.messages) ? input.chatContext.messages.length : 0,
      communityReports: input.communityReports?.length ?? 0,
      incidents: input.incidents?.length ?? 0,
      mapFeatures: input.mapFeatures?.length ?? 0,
      objects: input.objects?.length ?? 0,
      sourceHealth: input.sourceHealth?.length ?? 0
    }),
    categoryCounts: aiCategoryCounts(signals),
    citations: signals.map((signal) =>
      compactRecord({
        citationId: signal.citation,
        entityId: signal.entityId,
        entityType: signal.entityType,
        label: signal.title,
        location: signal.location,
        sourceSystemIds: signal.sourceSystemIds,
        updatedAt: signal.updatedAt
      })
    ),
    mapSnapshot: compactRecord({
      bbox: bboxForSignals(signals),
      candidates: mapSnapshotCandidates,
      contractVersion: "cop-ai-map-snapshot-candidates-v1"
    }),
    prioritySignals: signals
  });
}

function withAiResponseEvidence(
  response: AiCopResponse,
  input: {
    indexedContext: AiIndexedContext;
    mapSearch?: AiMapSearchContext;
    observability?: Record<string, unknown>;
    priorityContext: Record<string, unknown>;
    requestContext: Record<string, unknown>;
    semanticContext: AiSemanticContext;
  }
): AiCopResponse {
  const structured = isRecord(response.result.structured) ? response.result.structured : {};
  const mapActions = filterAiMapActionsForResponsePlaybook(
    aiMapActionsFromMapSearchContext(input.mapSearch),
    input.requestContext.responsePlaybook
  );
  return {
    ...response,
    result: {
      ...response.result,
      structured: {
        ...structured,
        ...(mapActions.length > 0 ? { mapActions } : {}),
        ...(input.mapSearch
          ? {
              mapSearch: compactRecord({
                contractVersion: input.mapSearch.contractVersion,
                generatedAt: input.mapSearch.generatedAt,
                query: input.mapSearch.query,
                resultCount: input.mapSearch.results.length,
                results: input.mapSearch.results.slice(0, 5),
                toolCall: input.mapSearch.toolCall,
                warnings: input.mapSearch.warnings
              })
            }
          : {}),
        evidence: compactRecord({
          contractVersion: "cop-ai-response-evidence-v1",
          indexed: compactRecord({
            citations: aiEvidenceSemanticCitations(input.indexedContext.citations, "I"),
            documentCount: input.indexedContext.semanticContext.includedDocumentCount,
            indexStatus: input.indexedContext.index.status,
            matchedDocumentCount: input.indexedContext.toolCall.matchedDocumentCount,
            query: input.indexedContext.query,
            status: input.indexedContext.semanticContext.status,
            toolCall: compactRecord({
              candidateDocumentCount: input.indexedContext.toolCall.candidateDocumentCount,
              invocationId: input.indexedContext.toolCall.invocationId,
              matchedDocumentCount: input.indexedContext.toolCall.matchedDocumentCount,
              status: input.indexedContext.toolCall.status,
              toolId: input.indexedContext.toolCall.toolId,
              warnings: input.indexedContext.toolCall.warnings
            })
          }),
          observability: input.observability,
          responsePlaybook: isRecord(input.requestContext.responsePlaybook)
            ? input.requestContext.responsePlaybook
            : undefined,
          mapSnapshot: isRecord(input.priorityContext.mapSnapshot) ? input.priorityContext.mapSnapshot : undefined,
          priority: compactRecord({
            citations: aiEvidencePriorityCitations(input.priorityContext),
            focusOrder: Array.isArray(input.priorityContext.focusOrder) ? input.priorityContext.focusOrder : undefined
          }),
          scope: isRecord(input.requestContext.scope) ? input.requestContext.scope : undefined,
          semantic: compactRecord({
            citations: aiEvidenceSemanticCitations(input.semanticContext.citations, "S"),
            documentCount: input.semanticContext.includedDocumentCount,
            model: input.semanticContext.model,
            status: input.semanticContext.status,
            warnings: input.semanticContext.warnings
          })
        })
      }
    }
  };
}

function filterAiMapActionsForResponsePlaybook(actions: AiMapAction[], responsePlaybook: unknown): AiMapAction[] {
  const playbook = isRecord(responsePlaybook) ? responsePlaybook : undefined;
  const allowedActions = normalizedAiActionSet(playbook?.allowedActions);
  if (allowedActions && !allowedActions.has("focus-map")) {
    return [];
  }
  const forbiddenActions = normalizedAiActionSet(playbook?.forbiddenActions);
  if (forbiddenActions?.has("focus-map")) {
    return [];
  }
  const limitedActions = actions.slice(0, 3);
  const intentId = optionalText(playbook?.intentId)?.toLowerCase();
  const domain = optionalText(playbook?.domain)?.toLowerCase();
  if (domain === "weather" || intentId?.startsWith("weather.")) {
    return limitedActions.slice(0, 1);
  }
  return limitedActions;
}

function normalizedAiActionSet(value: unknown): Set<string> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return normalized.length > 0 ? new Set(normalized) : undefined;
}

function buildAiPipelineObservability(input: {
  compressedContext: Record<string, unknown>;
  contextCompression: Record<string, unknown>;
  indexedDurationMs: number;
  operation: "chat-agent" | "situation-summary";
  providerDurationMs: number;
  retrievalIntent: AiRetrievalIntent;
  semanticDurationMs: number;
  uncompressedContext: Record<string, unknown>;
}): Record<string, unknown> {
  const uncompressedContextBytes = jsonByteLength(input.uncompressedContext);
  const compressedContextBytes = jsonByteLength(input.compressedContext);
  return compactRecord({
    compression: compactRecord({
      compressedContextBytes,
      ratio: compressionRatio(uncompressedContextBytes, compressedContextBytes),
      uncompressedContextBytes,
      ...compactRecord({
        includedCounts: isRecord(input.contextCompression.includedCounts)
          ? input.contextCompression.includedCounts
          : undefined,
        omittedCounts: isRecord(input.contextCompression.omittedCounts)
          ? input.contextCompression.omittedCounts
          : undefined,
        originalCounts: isRecord(input.contextCompression.originalCounts)
          ? input.contextCompression.originalCounts
          : undefined
      })
    }),
    contractVersion: "cop-ai-pipeline-observability-v1",
    operation: input.operation,
    retrievalIntent: input.retrievalIntent,
    timingsMs: compactRecord({
      indexedContext: input.indexedDurationMs,
      provider: input.providerDurationMs,
      semanticContext: input.semanticDurationMs
    })
  });
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
}

function compressionRatio(uncompressedBytes: number, compressedBytes: number): number | undefined {
  if (uncompressedBytes <= 0) {
    return undefined;
  }
  return Math.round((compressedBytes / uncompressedBytes) * 1000) / 1000;
}

function aiEvidencePriorityCitations(priorityContext: Record<string, unknown>): Record<string, unknown>[] {
  const citations = Array.isArray(priorityContext.citations) ? priorityContext.citations : [];
  return citations
    .filter(isRecord)
    .slice(0, 12)
    .map((citation) =>
      compactRecord({
        citationId: optionalText(citation.citationId),
        entityId: optionalText(citation.entityId),
        entityType: optionalText(citation.entityType),
        label: optionalText(citation.label),
        location: aiEvidenceLocation(citation.location),
        sourceSystemIds: Array.isArray(citation.sourceSystemIds)
          ? citation.sourceSystemIds.filter((item): item is string => typeof item === "string").slice(0, 8)
          : undefined,
        updatedAt: optionalText(citation.updatedAt)
      })
    );
}

function aiEvidenceSemanticCitations(
  citations: AiSemanticContext["citations"],
  expectedPrefix: "I" | "S"
): Record<string, unknown>[] {
  return citations.slice(0, 12).map((citation) =>
    compactRecord({
      citationId: citation.citationId.startsWith(expectedPrefix) ? citation.citationId : undefined,
      entityId: citation.entityId,
      entityType: citation.entityType,
      label: citation.label,
      location: citation.position,
      sourceSystemIds: citation.sourceSystemIds?.slice(0, 8),
      updatedAt: citation.updatedAt
    })
  );
}

function aiEvidenceLocation(value: unknown): { lat: number; lon: number } | undefined {
  const record = isRecord(value) ? value : undefined;
  const lat = record ? optionalFiniteNumber(record.lat, -90, 90) : undefined;
  const lon = record ? optionalFiniteNumber(record.lon, -180, 180) : undefined;
  return lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
}

function aiPrioritySignalFromRecord(
  entityType: AiPrioritySignal["entityType"],
  record: Record<string, unknown>,
  idKey: string
): AiPrioritySignal | undefined {
  const entityId = optionalText(record[idKey]);
  if (!entityId) {
    return undefined;
  }
  const title =
    optionalText(record.title) ?? optionalText(record.displayName) ?? optionalText(record.objectType) ?? entityId;
  const category = optionalText(record.category) ?? optionalText(record.type);
  const severity = optionalText(record.severity);
  const status = optionalText(record.status) ?? optionalText(record.health);
  const updatedAt =
    optionalText(record.updatedAt) ??
    optionalText(record.lastUpdatedAt) ??
    optionalText(record.observedAt) ??
    optionalText(record.submittedAt);
  const priorityScore = optionalFiniteNumber(record.priorityScore, 0, 1) ?? aiPriorityScore(entityType, record);
  return {
    category,
    citation: "P0",
    entityId,
    entityType,
    location: aiLocationFromRecord(record.location) ?? aiLocationFromRecord(record.position),
    priorityScore,
    reason: aiPriorityReason(entityType, category, severity, status, record),
    severity,
    sourceSystemIds: aiSourceSystemIds(record),
    status,
    title,
    updatedAt
  };
}

function aiPrioritySignalsFromChat(chatContext: Record<string, unknown> | undefined): AiPrioritySignal[] {
  const messages = Array.isArray(chatContext?.messages) ? chatContext.messages : [];
  return messages.flatMap((item, index) => {
    if (!isRecord(item)) {
      return [];
    }
    const body = optionalText(item.body);
    if (!body) {
      return [];
    }
    const entityId = optionalText(item.eventId) ?? `chat-message-${index}`;
    const sender = optionalText(item.senderDisplayName) ?? optionalText(item.sender) ?? "chat";
    const record = {
      body,
      category: "chat",
      eventId: entityId,
      status: "visible",
      title: sender,
      updatedAt: optionalText(item.timestamp)
    };
    const priorityScore = aiPriorityScore("chatMessage", record);
    return priorityScore > 0.2
      ? [
          {
            category: "chat",
            citation: "P0",
            entityId,
            entityType: "chatMessage" as const,
            priorityScore,
            reason: "Relevant visible chat context supplied by the client.",
            status: "visible",
            title: `${sender}: ${body.slice(0, 80)}`,
            updatedAt: optionalText(item.timestamp)
          }
        ]
      : [];
  });
}

function aiPriorityScore(entityType: AiPrioritySignal["entityType"], record: Record<string, unknown>): number {
  const text = JSON.stringify(record).toLocaleLowerCase("cs-CZ");
  let score = aiPriorityBaseScore(entityType);
  score += aiSeverityScore(optionalText(record.severity));
  score += aiStatusScore(optionalText(record.status) ?? optionalText(record.health));
  score += aiCategoryScore(optionalText(record.category) ?? optionalText(record.type), text);
  if (
    (optionalText(record.domain) ?? "").toLocaleLowerCase("cs-CZ") === "air" ||
    /track_stale|stale track|civil.*flight|letadl/u.test(text)
  ) {
    score -= /critical|warning|conflict|lost|incident/u.test(text) ? 0.06 : 0.22;
  }
  if (/low_confidence|zastaral|stale/u.test(text)) {
    score -= 0.14;
  }
  return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000;
}

function aiPriorityBaseScore(entityType: AiPrioritySignal["entityType"]): number {
  switch (entityType) {
    case "incident":
      return 0.48;
    case "communityReport":
      return 0.42;
    case "alert":
      return 0.32;
    case "mapFeature":
      return 0.3;
    case "chatMessage":
      return 0.24;
    case "sourceHealth":
      return 0.08;
    case "observedObject":
      return 0.05;
  }
}

function aiSeverityScore(severity: string | undefined): number {
  switch (severity) {
    case "critical":
      return 0.3;
    case "warning":
      return 0.18;
    case "advisory":
      return 0.08;
    default:
      return 0;
  }
}

function aiStatusScore(status: string | undefined): number {
  switch (status) {
    case "ACTIVE":
    case "active":
    case "monitoring":
    case "submitted":
    case "published":
      return 0.08;
    case "candidate":
      return 0.04;
    case "degraded":
    case "DISABLED":
      return 0.1;
    case "resolved":
    case "closed":
    case "ACKNOWLEDGED":
    case "ok":
    case "OK":
      return -0.08;
    default:
      return 0;
  }
}

function aiCategoryScore(category: string | undefined, text: string): number {
  const value = `${category ?? ""} ${text}`;
  if (/(flood|povod|hladin|hydro|river|řek|rek|water|voda|záplav|zaplav)/u.test(value)) {
    return 0.24;
  }
  if (/(fire|požár|pozar|kouř|kour|hotspot|firms)/u.test(value)) {
    return 0.22;
  }
  if (/(security|polic|kráde|krade|zlod|crime|bezpeč)/u.test(value)) {
    return 0.2;
  }
  if (
    /(medical|zdravot|zran|evaku|bridge|most|road|silnic|infrastructure|utility|outage|výpad|vypad|hazard|nebezpe)/u.test(
      value
    )
  ) {
    return 0.16;
  }
  if (/(traffic|doprav|weather|vítr|vitr|bouř|bour)/u.test(value)) {
    return 0.1;
  }
  return 0;
}

function aiPriorityReason(
  entityType: AiPrioritySignal["entityType"],
  category: string | undefined,
  severity: string | undefined,
  status: string | undefined,
  record: Record<string, unknown>
): string {
  const domain = optionalText(record.domain)?.toLocaleLowerCase("cs-CZ");
  const distanceM = optionalFiniteNumber(record.distanceM, 0, 10_000_000);
  const parts = [
    entityType,
    category ? `category=${category}` : undefined,
    severity ? `severity=${severity}` : undefined,
    status ? `status=${status}` : undefined,
    distanceM !== undefined ? `distanceM=${Math.round(distanceM)}` : undefined,
    domain === "air" ? "air-track-low-priority-unless-relevant" : undefined
  ].filter(Boolean);
  return parts.join("; ");
}

function aiLocationFromRecord(value: unknown): { lat: number; lon: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const lat = optionalFiniteNumber(value.lat, -90, 90);
  const lon = optionalFiniteNumber(value.lon, -180, 180);
  return lat !== undefined && lon !== undefined ? { lat: roundCoordinate(lat), lon: roundCoordinate(lon) } : undefined;
}

function aiSourceSystemIds(record: Record<string, unknown>): string[] | undefined {
  const values = [
    optionalText(record.sourceSystemId),
    ...aiStringList(record.sourceSystemIds),
    ...aiSourceRefs(record.sourceRefs)
  ].filter((item): item is string => Boolean(item));
  const unique = Array.from(new Set(values)).slice(0, 8);
  return unique.length ? unique : undefined;
}

function aiSourceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => (isRecord(item) ? aiStringList(item.sourceId) : []));
}

function aiStringList(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
}

function aiCategoryCounts(signals: AiPrioritySignal[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const signal of signals) {
    const key = signal.category ?? signal.entityType;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function bboxForSignals(
  signals: AiPrioritySignal[]
): { east: number; north: number; south: number; west: number } | undefined {
  const points = signals.flatMap((signal) => (signal.location ? [signal.location] : []));
  if (points.length === 0) {
    return undefined;
  }
  return {
    east: roundCoordinate(Math.max(...points.map((point) => point.lon))),
    north: roundCoordinate(Math.max(...points.map((point) => point.lat))),
    south: roundCoordinate(Math.min(...points.map((point) => point.lat))),
    west: roundCoordinate(Math.min(...points.map((point) => point.lon)))
  };
}

function timestampMillis(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    sourceSystemIds: object.provenance
      ?.map((item) => item.sourceSystemId)
      .filter(Boolean)
      .slice(0, 5),
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

function summarizeCommunityReportForAi(report: CommunityReportRecord): Record<string, unknown> {
  return compactRecord({
    attachmentCount: report.attachments.filter((attachment) => attachment.status === "uploaded").length,
    attachmentKinds: Array.from(
      new Set(
        report.attachments.filter((attachment) => attachment.status === "uploaded").map((attachment) => attachment.kind)
      )
    ).slice(0, 5),
    category: report.category,
    description: report.description?.slice(0, 600),
    location: {
      accuracyM: report.location.accuracyM,
      lat: roundCoordinate(report.location.lat),
      lon: roundCoordinate(report.location.lon),
      source: report.location.source
    },
    observedAt: report.observedAt,
    reportId: report.reportId,
    severity: communityReportSeverity(report),
    status: report.status,
    submittedAt: report.submittedAt,
    title: report.title,
    updatedAt: report.updatedAt,
    visibility: report.visibility
  });
}

function summarizeIncidentForAi(incident: IncidentRecord): Record<string, unknown> {
  return compactRecord({
    category: incident.category,
    confidence: incident.confidence,
    description: incident.description?.slice(0, 600),
    incidentId: incident.incidentId,
    location: {
      accuracyM: incident.location.accuracyM,
      label: incident.location.label,
      lat: roundCoordinate(incident.location.lat),
      lon: roundCoordinate(incident.location.lon),
      source: incident.location.source
    },
    severity: incident.severity,
    sourceRefs: incident.sourceRefs.slice(0, 8).map((sourceRef) =>
      compactRecord({
        id: sourceRef.id,
        kind: sourceRef.kind,
        observedAt: sourceRef.observedAt,
        sourceId: sourceRef.sourceId,
        title: sourceRef.title
      })
    ),
    status: incident.status,
    title: incident.title,
    updatedAt: incident.updatedAt
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

function summarizeAiChatContextForAi(value: unknown): Record<string, unknown> | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record) {
    return undefined;
  }
  const rawMessages = Array.isArray(record.messages) ? record.messages : [];
  const messages = rawMessages
    .flatMap((item) => {
      const message = summarizeAiChatMessageForAi(item);
      return message ? [message] : [];
    })
    .slice(-30);
  if (messages.length === 0) {
    return undefined;
  }
  return compactRecord({
    encrypted: record.encrypted === true,
    includedMessageCount: messages.length,
    messages,
    roomId: optionalTrimmedString(record.roomId, 160),
    source: record.source === "browser-visible-decrypted-timeline" ? record.source : undefined,
    visibleMessageCount: readBoundedInteger(record.visibleMessageCount, messages.length, 0, 5000)
  });
}

function summarizeAiChatMessageForAi(value: unknown): Record<string, unknown> | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record) {
    return undefined;
  }
  const body = optionalTrimmedString(record.body, 1200);
  if (!body) {
    return undefined;
  }
  const ai = isRecord(record.ai) ? record.ai : undefined;
  return compactRecord({
    ai: ai
      ? compactRecord({
          auditId: optionalTrimmedString(ai.auditId, 160),
          provider: optionalTrimmedString(ai.provider, 80),
          status: optionalTrimmedString(ai.status, 40),
          type: optionalTrimmedString(ai.type, 80)
        })
      : undefined,
    body,
    eventId: optionalTrimmedString(record.eventId, 160),
    kind: optionalTrimmedString(record.kind, 40),
    own: record.own === true,
    sender: optionalTrimmedString(record.sender, 160),
    senderDisplayName: optionalTrimmedString(record.senderDisplayName, 160),
    timestamp: optionalTrimmedString(record.timestamp, 80)
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

function summarizeGroupAiAssistantForAi(group: CommunityGroupRecord): Record<string, unknown> {
  const chat = isRecord(group.metadata.chat) ? group.metadata.chat : {};
  const aiAssistant = isRecord(chat.aiAssistant) ? chat.aiAssistant : {};
  const matrixBot = isRecord(aiAssistant.matrixBot) ? aiAssistant.matrixBot : {};
  const e2ee = isRecord(aiAssistant.e2ee) ? aiAssistant.e2ee : {};
  return compactRecord({
    enabled: aiAssistant.enabled === true,
    e2ee: Object.keys(e2ee).length
      ? compactRecord({
          keyModel: optionalText(e2ee.keyModel),
          roomKeyPolicy: optionalText(e2ee.roomKeyPolicy),
          serverReadsHistory: e2ee.serverReadsHistory === true,
          status: optionalText(e2ee.status)
        })
      : undefined,
    label: optionalText(aiAssistant.label),
    matrixBot: Object.keys(matrixBot).length
      ? compactRecord({
          membership: optionalText(matrixBot.membership),
          roomId: optionalText(matrixBot.roomId),
          status: optionalText(matrixBot.status),
          userId: optionalText(matrixBot.userId)
        })
      : undefined,
    mode: optionalText(aiAssistant.mode),
    updatedAt: optionalText(aiAssistant.updatedAt)
  });
}

function aiMatrixBotConfig(): {
  deviceId: string;
  displayName: string;
  enabled: boolean;
  userId: string;
} {
  return {
    deviceId: optionalTrimmedString(process.env.COP_AI_MATRIX_BOT_DEVICE_ID, 64) ?? "COP.AI.Agent",
    displayName: optionalTrimmedString(process.env.COP_AI_MATRIX_BOT_DISPLAY_NAME, 80) ?? "COP AI Assistant",
    enabled: readBoolean(process.env.COP_AI_MATRIX_BOT_ENABLED, true),
    userId: optionalTrimmedString(process.env.COP_AI_MATRIX_BOT_USER_ID, 120) ?? "cop.ai.agent"
  };
}

function aiMatrixBotActor(config = aiMatrixBotConfig()): AuthenticatedActor {
  return {
    authMode: "lab",
    displayName: config.displayName,
    roles: ["cop_ai_agent"],
    subjectId: config.userId,
    username: config.userId
  };
}

function aiMatrixBotBootstrapReady(bootstrap: MessagingMatrixBootstrap): bootstrap is MessagingMatrixBootstrap & {
  accessToken: string;
  homeserverBaseUrl: string;
  userId: string;
} {
  return (
    bootstrap.chatAvailable === true &&
    bootstrap.tokenAvailable === true &&
    Boolean(bootstrap.accessToken) &&
    Boolean(bootstrap.homeserverBaseUrl) &&
    Boolean(bootstrap.userId)
  );
}

async function joinMatrixRoomAsAiBot(
  bootstrap: MessagingMatrixBootstrap & { accessToken: string; homeserverBaseUrl: string },
  roomId: string,
  timeoutMs: number
): Promise<{ joined: boolean; warnings: string[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${bootstrap.homeserverBaseUrl.replace(/\/+$/u, "")}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
      {
        body: JSON.stringify({ reason: "COP AI agent explicit room consent" }),
        headers: {
          Authorization: `Bearer ${bootstrap.accessToken}`,
          "Content-Type": "application/json"
        },
        method: "POST",
        signal: controller.signal
      }
    );
    if (response.ok) {
      return { joined: true, warnings: [] };
    }
    return {
      joined: false,
      warnings: [`Matrix bot room join returned HTTP ${response.status}.`]
    };
  } catch (error) {
    return {
      joined: false,
      warnings: [`Matrix bot room join failed: ${sanitizeAiMatrixBotWarning(errorMessage(error))}`]
    };
  } finally {
    clearTimeout(timeout);
  }
}

function aiMatrixBotE2eeMetadata(status: AiMatrixBotProvisionStatus, requestNow: Date): Record<string, unknown> {
  return compactRecord({
    keyModel: "dedicated_matrix_account_device",
    plaintextProxy: false,
    roomKeyPolicy: "future_megolm_sessions_after_join",
    serverReadsHistory: false,
    status: status === "joined" ? "ready_for_future_messages" : "pending_matrix_membership",
    updatedAt: requestNow.toISOString()
  });
}

function aiAssistantConsentGranted(metadata: Record<string, unknown>): boolean {
  const chat = isRecord(metadata.chat) ? metadata.chat : {};
  const aiAssistant = isRecord(chat.aiAssistant) ? chat.aiAssistant : {};
  if (aiAssistant.enabled !== true) {
    return true;
  }
  const consent = isRecord(aiAssistant.consent) ? aiAssistant.consent : {};
  return (
    consent.granted === true &&
    optionalText(consent.scope) === "matrix-room-member" &&
    optionalText(consent.termsVersion) === "cop-ai-room-agent-consent-v1"
  );
}

function metadataEnablesAiAssistant(metadata: Record<string, unknown>): boolean {
  const chat = isRecord(metadata.chat) ? metadata.chat : {};
  const aiAssistant = isRecord(chat.aiAssistant) ? chat.aiAssistant : {};
  return aiAssistant.enabled === true;
}

function sanitizeAiMatrixBotWarning(value: unknown): string {
  const text = optionalTrimmedString(value, 220) ?? "AI Matrix bot provisioning status is unavailable.";
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/access[_-]?token[=:]\s*[A-Za-z0-9._~+/=-]+/giu, "accessToken=[redacted]")
    .replace(/password[=:]\s*[^;\s]+/giu, "password=[redacted]");
}

function aiAuditMetadata(response: AiCopResponse, actor: AuthenticatedActor): Record<string, unknown> {
  return {
    actorAuthMode: actor.authMode,
    actorSubjectId: actor.subjectId,
    auditId: response.auditId,
    model: response.model,
    modelRole: response.routing?.modelRole,
    provider: response.provider,
    requestId: response.requestId,
    routingComplexityScore: response.routing?.complexityScore,
    routingStrategy: response.routing?.strategy,
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

function errorMessageFromResponse(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return (
    optionalTrimmedString(value.message, 500) ??
    optionalTrimmedString(value.error, 500) ??
    optionalTrimmedString(value.detail, 500)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function upstreamHttpStatus(error: unknown): number | undefined {
  if (isRecord(error) && typeof error.status === "number" && Number.isInteger(error.status)) {
    return error.status;
  }
  const match = errorMessage(error).match(/^(\d{3})\b/u);
  if (!match) {
    return undefined;
  }
  const status = Number(match[1]);
  return Number.isInteger(status) ? status : undefined;
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

function buildCorsOriginResolver(value: string | undefined): FastifyCorsOptions["origin"] {
  const configuredOrigins = parseCsv(value);
  const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : defaultApiAllowedOrigins;
  const allowedOriginSet = new Set(allowedOrigins);
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, allowedOriginSet.has(origin));
  };
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function streamHealthStatus(metrics: CopStreamBroadcaster["metrics"], now: Date): "degraded" | "ok" {
  if (metrics.backpressureActive) {
    return "degraded";
  }
  const lastWriteErrorMs = metrics.lastWriteErrorAt ? Date.parse(metrics.lastWriteErrorAt) : Number.NaN;
  return Number.isFinite(lastWriteErrorMs) && now.getTime() - lastWriteErrorMs < 5 * 60 * 1000 ? "degraded" : "ok";
}
