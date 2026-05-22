export interface HealthStatus {
  status: string;
  timestamp: string;
}

export interface SourceSystem {
  sourceSystemId: string;
  displayName: string;
  sourceType: string;
  status?: string;
  synthetic: boolean;
  attributes?: Record<string, unknown>;
}

export interface CopObject {
  objectId: string;
  objectType: string;
  affiliation: string;
  domain: string;
  status: string;
  confidence?: number;
  synthetic?: boolean;
  lastUpdatedAt?: string;
  position?: {
    lat: number;
    lon: number;
    altitudeM?: number | null;
  };
  movement?: {
    speedMps?: number | null;
    headingDeg?: number | null;
    verticalRateMps?: number | null;
  };
  speedMps?: number | null;
  headingDeg?: number | null;
  verticalRateMps?: number | null;
  attributes?: {
    conflictEvidence?: ObjectConflictEvidence;
    flightData?: FlightDataAttributes;
    provenance?: ObjectProvenance;
    [key: string]: unknown;
  };
}

export interface FlightDataAttributes {
  aircraft?: Record<string, unknown>;
  callsign?: string;
  deduplication?: Record<string, unknown>;
  icao24?: string;
  metadata?: Record<string, unknown>;
  originCountry?: string;
  providerLicenses?: Array<Record<string, unknown>>;
  providers?: Array<{
    enabled?: boolean;
    label?: string;
    licenseName?: string;
    mode?: string;
    sourceId?: string;
  }>;
  quality?: {
    confidence?: number;
    positionAgeSeconds?: number;
    stale?: boolean;
  };
  registration?: string;
  sources?: Array<{
    fetchedAt?: string;
    seenAt?: string;
    sourceId?: string;
    sourceRecordId?: string;
  }>;
}

export interface ObjectProvenance {
  adapterId?: string;
  adapterVersion?: string;
  eventId?: string;
  informationCredibility?: string;
  ingestTimestamp?: string;
  latencyMs?: number;
  producerTimestamp?: string;
  sourceDeviceId?: string | null;
  sourceReliability?: string;
  sourceSystemId?: string;
  synthetic?: boolean;
}

export interface ConflictSignal {
  detail: string;
  observedAt?: string;
  severity: "info" | "warning";
  sourceSystemIds: string[];
  title: string;
  type: string;
}

export interface ObjectConflictEvidence {
  evaluatedAt: string;
  objectId: string;
  severity: "info" | "warning";
  signals: ConflictSignal[];
  sourceSystemIds: string[];
  state: "CLEAR" | "CONFLICTED";
}

export interface ServerTrackHistoryPoint {
  affiliation: string;
  confidence?: number;
  eventId?: string;
  ingestTimestamp?: string;
  lat: number;
  lon: number;
  objectId: string;
  objectType?: string;
  producerTimestamp?: string;
  sourceSystemId?: string;
  status?: string;
  synthetic?: boolean;
  timestamp: string;
}

export interface CopDashboardData {
  alerts: CopAlert[];
  health: HealthStatus;
  sources: SourceSystem[];
  sourceHealth: SourceHealthItem[];
  streamHealth?: CopStreamHealth;
  objects: CopObject[];
  trackHistory?: Record<string, ServerTrackHistoryPoint[]>;
}

export type SituationLayerId =
  | "air_quality"
  | "community"
  | "flight_airports"
  | "flight_airspaces"
  | "flood"
  | "ground"
  | "mobile"
  | "mobile_coverage"
  | "mobile_network"
  | "traffic"
  | "warnings"
  | "weather";
export type SafetyLayerId = "flood" | "warnings";
export type TakLayerId = "ground" | "mobile" | "traffic";
export type SafetyDataSourceId = "chmi_alerts" | "chmi_hydro" | "mock";

export interface MapBounds {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface SituationLayer {
  defaultVisible: boolean;
  description?: string;
  expectedCadenceSeconds?: number;
  geometryTypes?: string[];
  label: string;
  layerId: SituationLayerId;
}

export interface SituationFeatureCollectionResponse {
  contractVersion: "cop-situation-source-v1";
  features: SituationFeature[];
  generatedAt: string;
  query: {
    bbox: MapBounds;
    layers: SituationLayerId[];
    limit: number;
    sources?: string[];
    technology?: string;
  };
  source: {
    generatedAt?: string;
    sourceId: "situation-data-api";
    sourceType: "PUBLIC_SITUATION_AGGREGATE";
  };
  cache?: {
    key: string;
    status: "coalesced" | "hit" | "miss" | "stale";
    ttlMs: number;
    upstreamBbox: MapBounds;
  };
  sourceHealth?: SourceHealthOverride;
  sources: SituationSourceDescriptor[];
  summary: {
    featureCount: number;
    sourceCount: number;
    staleFeatureCount: number;
    warningCount: number;
  };
  type: "FeatureCollection";
  warnings: string[];
}

export interface SourceHealthOverride {
  detail?: string;
  evaluatedAt: string;
  generatedAt?: string;
  health: "DEGRADED" | "ONLINE" | "STALE" | "UNAVAILABLE" | "WAITING";
  lastError?: string;
  lastPollAt?: string;
  lastSuccessAt?: string;
  summary?: Record<string, unknown>;
  warnings?: string[];
}

export interface SituationFeature {
  geometry: SituationGeometry;
  id?: string | number;
  properties: SituationFeatureProperties;
  type: "Feature";
}

export type SituationGeometry =
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<[number, number]>; type: "LineString" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface SituationFeatureProperties {
  affectedAreas?: string[];
  affiliation?: string;
  category: string;
  certainty?: string;
  confidence?: number;
  assumptions?: Record<string, unknown>;
  demSource?: string;
  description?: string;
  effectiveAt?: string;
  disclaimer?: string;
  estimatedSignalDbm?: number;
  expiresAt?: string;
  featureId: string;
  generatedAt?: string;
  geocodes?: Array<{ scheme: string; value: string }>;
  headline?: string;
  label: string;
  layer: SituationLayerId;
  license?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  modelVersion?: string;
  basis?: string[];
  notices?: string[];
  observedAt?: string;
  operator?: string;
  providerId?: string;
  providerLayerId?: string;
  quality?: string;
  receivedAt?: string;
  recommendedAction?: string;
  resolutionM?: number;
  severity?: string;
  sourceId: string;
  stale?: boolean;
  status?: string;
  summary?: string;
  tags?: Record<string, unknown>;
  technology?: string;
  urgency?: string;
  validUntil?: string;
}

export interface SituationSourceDescriptor {
  baseUrl?: string;
  enabled?: boolean;
  label?: string;
  layers?: SituationLayerId[];
  license?: Record<string, unknown>;
  mode?: string;
  priority?: number;
  sourceId: string;
  updateCadenceSeconds?: number;
}

export interface SituationLayersResponse {
  items: SituationLayer[];
  serverTimestamp?: string;
  sourceHealth?: SourceHealthOverride;
  sourceStatus?: string;
  warnings?: string[];
}

export interface SituationSourcesResponse {
  items: SituationSourceDescriptor[];
  serverTimestamp?: string;
  sourceHealth?: SourceHealthOverride;
  sourceStatus?: string;
  warnings?: string[];
}

export interface SituationFeatureOptions {
  bbox: MapBounds;
  layers: SituationLayerId[];
  limit?: number;
  sources?: string[];
  technology?: string;
}

export interface SafetyLayer {
  defaultVisible: boolean;
  description?: string;
  expectedCadenceSeconds?: number;
  geometryTypes?: string[];
  label: string;
  layerId: SafetyLayerId;
}

export interface SafetyFeatureCollectionResponse {
  contractVersion: "cop-safety-source-v1";
  features: SafetyFeature[];
  generatedAt: string;
  query: {
    bbox: MapBounds;
    layers: SafetyLayerId[];
    limit: number;
    sources?: SafetyDataSourceId[];
  };
  source: {
    generatedAt?: string;
    sourceId: "safety-data-api";
    sourceType: "PUBLIC_SAFETY_AGGREGATE";
  };
  cache?: {
    key: string;
    status: "coalesced" | "hit" | "miss" | "stale";
    ttlMs: number;
    upstreamBbox: MapBounds;
  };
  sourceHealth?: SourceHealthOverride;
  sources: SafetySourceDescriptor[];
  summary: {
    advisoryCount: number;
    criticalCount: number;
    featureCount: number;
    sourceCount: number;
    staleFeatureCount: number;
    warningCount: number;
  };
  type: "FeatureCollection";
  warnings: string[];
}

export interface SafetyFeature {
  geometry: SafetyGeometry;
  id?: string | number;
  properties: SafetyFeatureProperties;
  type: "Feature";
}

export type SafetyGeometry =
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface SafetyFeatureProperties {
  affectedAreas?: string[];
  category: string;
  certainty?: string;
  confidence?: number;
  description?: string;
  effectiveAt?: string;
  expiresAt?: string;
  featureId: string;
  geocodes?: Array<{ scheme: string; value: string }>;
  headline: string;
  layer: SafetyLayerId;
  license?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  observedAt?: string;
  recommendedAction?: string;
  severity?: string;
  sourceId: string;
  stale?: boolean;
  tags?: Record<string, unknown>;
  urgency?: string;
}

export interface SafetySourceDescriptor {
  baseUrl?: string;
  enabled?: boolean;
  label?: string;
  layers?: SafetyLayerId[];
  license?: Record<string, unknown>;
  mode?: string;
  priority?: number;
  sourceId: SafetyDataSourceId;
  updateCadenceSeconds?: number;
}

export interface SafetyDataPublicConfig {
  cacheMaxEntries?: number;
  cacheTtlSeconds?: number;
  defaultBbox?: MapBounds;
  enabledSources?: SafetyDataSourceId[];
  hydroMaxStations?: number;
  providers?: Array<{ authConfigured?: boolean; baseUrl?: string; sourceId: SafetyDataSourceId }>;
  requestTimeoutMs?: number;
  staleAfterSeconds?: number;
  staleIfErrorSeconds?: number;
}

export interface SafetyLayersResponse {
  items: SafetyLayer[];
  serverTimestamp?: string;
  sourceHealth?: SourceHealthOverride;
  sourceStatus?: string;
  warnings?: string[];
}

export interface SafetySourcesResponse {
  items: SafetySourceDescriptor[];
  serverTimestamp?: string;
  sourceHealth?: SourceHealthOverride;
  sourceStatus?: string;
  warnings?: string[];
}

export interface SafetyConfigResponse {
  config: SafetyDataPublicConfig;
  serverTimestamp?: string;
  sourceHealth?: SourceHealthOverride;
  sourceStatus?: string;
  warnings?: string[];
}

export interface SafetyFeatureOptions {
  bbox: MapBounds;
  layers: SafetyLayerId[];
  limit?: number;
}

export interface TakLayer {
  defaultVisible: boolean;
  description?: string;
  expectedCadenceSeconds?: number;
  geometryTypes?: string[];
  label: string;
  layerId: TakLayerId;
}

export interface TakSourceDescriptor {
  baseUrl?: string;
  enabled?: boolean;
  label?: string;
  layers?: TakLayerId[];
  license?: Record<string, unknown>;
  mode?: string;
  priority?: number;
  sourceId: string;
  updateCadenceSeconds?: number;
}

export type TakGeometry =
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<[number, number]>; type: "LineString" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface TakFeatureProperties {
  affiliation?: string;
  category: string;
  confidence?: number;
  featureId: string;
  label: string;
  layer: TakLayerId;
  license?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  observedAt?: string;
  receivedAt?: string;
  sourceId: string;
  stale?: boolean;
  tags?: Record<string, unknown>;
  validUntil?: string;
}

export interface TakFeature {
  geometry: TakGeometry;
  id?: string | number;
  properties: TakFeatureProperties;
  type: "Feature";
}

export interface TakFeatureCollectionResponse {
  contractVersion: "cop-tak-source-v1";
  cache?: {
    key: string;
    status: "coalesced" | "hit" | "miss" | "stale";
    ttlMs: number;
    upstreamBbox: MapBounds;
  };
  features: TakFeature[];
  generatedAt: string;
  query: {
    bbox: MapBounds;
    layers: TakLayerId[];
    limit: number;
  };
  source: {
    generatedAt?: string;
    sourceId: "tak-gateway-api";
    sourceType: "TAK_COT_GATEWAY";
  };
  sourceHealth?: SourceHealthOverride;
  sources: TakSourceDescriptor[];
  summary: {
    affiliationCounts?: Record<string, number>;
    eventCount?: number;
    featureCount: number;
    sourceCount: number;
    staleFeatureCount: number;
    warningCount: number;
  };
  type: "FeatureCollection";
  warnings: string[];
}

export interface FlightReferenceSourceDescriptor {
  enabled?: boolean;
  label?: string;
  layers?: string[];
  license?: Record<string, unknown>;
  mode?: string;
  sourceId: string;
  updateCadenceSeconds?: number;
}

export interface FlightReferenceFeatureCollectionResponse {
  contractVersion: "cop-flight-reference-v1";
  features: SituationFeature[];
  generatedAt: string;
  query: {
    bbox: MapBounds;
    layers: string[];
    limit: number;
  };
  source: {
    generatedAt?: string;
    sourceId: "flight-data-api";
    sourceType: "PUBLIC_FLIGHT_REFERENCE";
  };
  sourceHealth?: SourceHealthOverride;
  sources: FlightReferenceSourceDescriptor[];
  summary: {
    featureCount: number;
    sourceCount: number;
    staleFeatureCount: number;
    warningCount: number;
  };
  type: "FeatureCollection";
  warnings: string[];
}

export interface CommunityFeatureCollectionResponse {
  features: SituationFeature[];
  generatedAt: string;
  query?: {
    bbox: MapBounds;
    layerIds: string[];
    limit: number;
  };
  source: {
    generatedAt?: string;
    sourceId: "community_reports";
    sourceType: "COMMUNITY_REPORTS";
  };
  summary: {
    featureCount: number;
    submittedCount?: number;
    uploadedAttachmentCount?: number;
  };
  type: "FeatureCollection";
  warnings?: string[];
}

export interface TakLayersResponse {
  items: TakLayer[];
  serverTimestamp?: string;
  sourceHealth?: SourceHealthOverride;
  sourceStatus?: string;
  warnings?: string[];
}

export interface TakSourcesResponse {
  items: TakSourceDescriptor[];
  serverTimestamp?: string;
  sourceHealth?: SourceHealthOverride;
  sourceStatus?: string;
  warnings?: string[];
}

export interface TakFeatureOptions {
  bbox: MapBounds;
  layers: TakLayerId[];
  limit?: number;
}

export type MapCatalogAudience = "admin" | "authenticated" | "diagnostic" | "partner" | "public";
export type MapCatalogLayerKind = "aggregate" | "mvt_tiles" | "raster_tiles" | "static_reference" | "track_stream" | "user_objects" | "vector_features";
export type MapCatalogLayerRole = "diagnostic" | "overlay" | "partner" | "primary" | "reference" | "user";
export type MapCatalogSourceRole = "aggregate" | "diagnostic" | "final" | "input" | "mock" | "projection" | "reference";

export interface MapCatalogProvider {
  label: string;
  providerId: string;
  status: "disabled" | "online" | "unavailable";
}

export interface MapCatalogGroup {
  groupId: string;
  icon?: string;
  label: string;
  order: number;
  parentGroupId?: string;
}

export interface MapCatalogFilter {
  defaultValue?: unknown;
  filterId: string;
  label: string;
  type: "multi_select" | "select" | "toggle";
  values?: string[];
}

export interface MapCatalogQuery {
  categoryIds?: string[];
  maxFeatures?: number;
  mode: "bbox" | "internal" | "stream" | "tile";
  providerId: string;
  providerLayerIds?: string[];
  providerSourceIds?: string[];
  streamId: string;
}

export interface MapCatalogLayer {
  audience: MapCatalogAudience;
  cacheTtlSeconds?: number;
  defaultVisible: boolean;
  description?: string;
  filters?: MapCatalogFilter[];
  geometryTypes?: string[];
  groupId: string;
  kind: MapCatalogLayerKind;
  label: string;
  layerId: string;
  legal?: {
    attribution?: string;
    notes?: string[];
  };
  maxZoom?: number;
  minZoom?: number;
  provenance?: {
    sourceIds: string[];
    technicalInputs?: string[];
  };
  query: MapCatalogQuery;
  refreshSeconds?: number;
  role: MapCatalogLayerRole;
  selectable: boolean;
  styleProfile: string;
}

export interface MapCatalogSource {
  audience: MapCatalogAudience;
  cacheTtlSeconds?: number;
  enabled: boolean;
  feedsCatalogLayerIds?: string[];
  label: string;
  providerId: string;
  selectableInMap: boolean;
  sourceId: string;
  sourceRole: MapCatalogSourceRole;
  updateCadenceSeconds?: number;
  usedByCatalogLayerIds?: string[];
  visibleInDiagnostics: boolean;
}

export interface MapCatalogResponse {
  catalogVersion: "map-catalog-v1";
  generatedAt: string;
  groups: MapCatalogGroup[];
  layers: MapCatalogLayer[];
  locale: string;
  providers: MapCatalogProvider[];
  sources: MapCatalogSource[];
  warnings: string[];
}

export interface MapCatalogOptions {
  includeDiagnostics?: boolean;
  includePartner?: boolean;
  locale?: string;
}

export interface MapFeatureQueryOptions {
  bbox: MapBounds;
  filters?: Record<string, Record<string, unknown>>;
  includeDiagnostics?: boolean;
  includePartner?: boolean;
  layerIds: string[];
  limit?: number;
}

export interface MapFeatureQueryResponse {
  contractVersion: "cop-map-query-v1";
  community?: CommunityFeatureCollectionResponse;
  flight?: FlightReferenceFeatureCollectionResponse;
  generatedAt: string;
  query: {
    bbox: MapBounds;
    layerIds: string[];
    limit: number;
  };
  safety?: SafetyFeatureCollectionResponse;
  situation?: SituationFeatureCollectionResponse;
  summary: {
    featureCount: number;
    layerCount: number;
    warningCount: number;
  };
  tak?: TakFeatureCollectionResponse;
  warnings: string[];
}

export interface SourceHealthItem {
  acceptedEvents: number;
  avgConfidence?: number;
  avgLatencyMs?: number;
  currentTracks: number;
  displayName: string;
  eventTypeCounts?: Record<string, number>;
  expiredTracks: number;
  health: "DEGRADED" | "DISABLED" | "ONLINE" | "QUIET" | "STALE" | "UNAVAILABLE" | "WAITING";
  detail?: string;
  lastError?: string;
  lastEventAt?: string;
  lastLatencyMs?: number;
  lastObservationAgeSeconds?: number;
  lastObservationAt?: string;
  lowConfidenceTracks: number;
  sourceSystemId: string;
  sourceType: string;
  staleTracks: number;
  status?: string;
  synthetic: boolean;
  totalTracks: number;
  warnings?: string[];
}

export type CopAlertSeverity = "critical" | "info" | "warning";
export type CopAlertStatus = "ACKNOWLEDGED" | "ACTIVE";
export type AoiRuleAffiliationScope = "all" | "friend" | "hostile" | "unknown";
export type CopAlertType = "AOI_ENTRY" | "LOW_CONFIDENCE" | "SOURCE_DEGRADED" | "TRACK_CONFLICT" | "TRACK_LOST" | "TRACK_STALE";

export interface CopActor {
  authMode: "lab" | "oidc";
  displayName: string;
  email?: string;
  subjectId: string;
  username: string;
}

export interface AlertPreferences {
  aoiRules?: AoiRule[];
  enabledTypes?: CopAlertType[];
  minimumSeverity?: CopAlertSeverity;
}

export interface AoiRule {
  affiliationScope?: AoiRuleAffiliationScope;
  color?: string;
  enabled: boolean;
  fillOpacity?: number;
  id: string;
  lat: number;
  lon: number;
  name: string;
  radiusKm: number;
  severity?: CopAlertSeverity;
}

export interface ServerUserProfile {
  actor: CopActor;
  alertPreferences: AlertPreferences;
  preferences: Record<string, unknown>;
  updatedAt: string | null;
}

export interface MessagingStatusResponse {
  architecture?: Record<string, unknown>;
  chatAvailable: boolean;
  checkedAt: string;
  contractVersion: "cop-messaging-status-v1";
  detail?: string;
  enabled: boolean;
  features?: Record<string, unknown>;
  providerId: "csm.messaging";
  publicUrl?: string;
  security?: Record<string, unknown>;
  serviceName: string;
  status: "degraded" | "disabled" | "online";
  warnings: string[];
}

export interface CopAlert {
  acknowledgedAt?: string;
  alertId: string;
  detail: string;
  evidence?: Record<string, unknown>;
  map?: {
    lat: number;
    lon: number;
    radiusKm: number;
  };
  objectId?: string;
  observedAt: string;
  severity: CopAlertSeverity;
  sourceSystemId?: string;
  status: CopAlertStatus;
  title: string;
  type: CopAlertType;
  updatedAt: string;
}

export type CopStreamStatus = "connecting" | "degraded" | "live" | "offline";

export interface CopStreamServerMetrics {
  backpressureActive: boolean;
  backpressureClientThreshold: number;
  backpressureMessagesTotal: number;
  clientCount: number;
  deltaMessagesTotal: number;
  heartbeatMessagesTotal: number;
  lastBackpressureAt?: string;
  lastClientConnectedAt?: string;
  lastClientDisconnectedAt?: string;
  lastDeltaAt?: string;
  lastHeartbeatAt?: string;
  lastMessageAt?: string;
  lastReconnectRequiredAt?: string;
  lastSnapshotAt?: string;
  lastWriteErrorAt?: string;
  reconnectRequiredMessagesTotal: number;
  recommendedRetryMs: number;
  sequence: number;
  snapshotMessagesTotal: number;
  writeErrorsTotal: number;
}

export interface CopStreamHealth {
  metrics: CopStreamServerMetrics;
  serverTimestamp: string;
  status: "degraded" | "ok";
}

export type CopStreamMessage =
  | {
      changes: Array<{ changeType: "OBJECT_SNAPSHOT" | "OBJECT_UPSERT"; object: CopObject }>;
      sequence: number;
      serverTimestamp: string;
      subscriptionId: string;
      type: "snapshot";
    }
  | {
      changes: Array<{ changeType: "OBJECT_UPSERT"; object: CopObject }>;
      sequence: number;
      serverTimestamp: string;
      type: "delta";
    }
  | {
      sequence: number;
      serverTimestamp: string;
      type: "heartbeat";
    }
  | {
      clientCount: number;
      reason: string;
      recommendedRetryMs: number;
      sequence: number;
      serverTimestamp: string;
      severity: "info" | "warning";
      threshold: number;
      type: "backpressure";
      writeErrorsTotal: number;
    }
  | {
      reason: string;
      retryAfterMs: number;
      sequence: number;
      serverTimestamp: string;
      severity: "info" | "warning";
      type: "reconnect_required";
    };

export interface CopStreamConnection {
  close: () => void;
}

export interface CopStreamHandlers {
  onError: (error: Error) => void;
  onMessage: (message: CopStreamMessage) => void;
  onOpen: () => void;
}

export interface CopHistoryOptions {
  limit: number;
  seconds: number;
}

export interface CopDashboardFilters {
  includeSynthetic: boolean;
  minConfidence: number;
}

export type CopLayer = "air-situation" | "sim-air" | "uav" | "friendly" | "foreign" | "public-flights" | "data-quality";
export const copLayerIds: CopLayer[] = ["air-situation", "sim-air", "uav", "friendly", "foreign", "public-flights", "data-quality"];

export async function fetchCopDashboardData(
  apiBase: string,
  token: string | undefined,
  historyOptions?: CopHistoryOptions
): Promise<CopDashboardData> {
  const headers = authHeaders(token);
  const [health, sources, sourceHealth, streamHealth, tracks, alerts, history] = await Promise.all([
    fetchJson<HealthStatus>(`${apiBase}/health/ready`),
    fetchJson<{ items?: SourceSystem[] }>(`${apiBase}/api/v1/sources`, { headers }),
    fetchOptionalJson<{ items?: SourceHealthItem[] }>(`${apiBase}/api/v1/sources/health`, { headers }),
    fetchOptionalJson<CopStreamHealth>(`${apiBase}/api/v1/stream/cop/health`, { headers }),
    fetchJson<{ items?: CopObject[] }>(`${apiBase}/api/v1/cop/tracks?includeSynthetic=true`, { headers }),
    token
      ? fetchOptionalJson<{ items?: CopAlert[] }>(`${apiBase}/api/v1/cop/alerts`, { headers })
      : Promise.resolve(undefined),
    historyOptions
      ? fetchOptionalJson<{ items?: Array<{ objectId: string; points: ServerTrackHistoryPoint[] }> }>(
          `${apiBase}/api/v1/cop/track-history?seconds=${historyOptions.seconds}&limit=${historyOptions.limit}`,
          { headers }
        )
      : Promise.resolve(undefined)
  ]);

  return {
    alerts: alerts?.items ?? [],
    health,
    sources: sources.items ?? [],
    sourceHealth: sourceHealth?.items ?? [],
    streamHealth,
    objects: tracks.items ?? [],
    trackHistory: history?.items ? Object.fromEntries(history.items.map((item) => [item.objectId, item.points])) : undefined
  };
}

export async function fetchCopAlerts(apiBase: string, token: string | undefined): Promise<CopAlert[]> {
  if (!token) {
    return [];
  }
  const headers = authHeaders(token);
  const response = await fetchOptionalJson<{ items?: CopAlert[] }>(`${apiBase}/api/v1/cop/alerts`, { headers });
  return response?.items ?? [];
}

export async function fetchMapCatalog(apiBase: string, token: string | undefined, options: MapCatalogOptions = {}): Promise<MapCatalogResponse> {
  const query = new URLSearchParams();
  if (options.includeDiagnostics) {
    query.set("includeDiagnostics", "true");
  }
  if (options.includePartner) {
    query.set("includePartner", "true");
  }
  if (options.locale) {
    query.set("locale", options.locale);
  }
  const encodedQuery = query.toString();
  const suffix = encodedQuery ? `?${encodedQuery}` : "";
  return fetchJson<MapCatalogResponse>(`${apiBase}/api/v1/map/catalog${suffix}`, {
    headers: authHeaders(token)
  });
}

export async function fetchMapFeatures(
  apiBase: string,
  token: string | undefined,
  options: MapFeatureQueryOptions
): Promise<MapFeatureQueryResponse> {
  return fetchJson<MapFeatureQueryResponse>(`${apiBase}/api/v1/map/query`, {
    body: JSON.stringify({
      bbox: [options.bbox.west, options.bbox.south, options.bbox.east, options.bbox.north],
      filters: options.filters ?? {},
      includeDiagnostics: options.includeDiagnostics === true,
      includePartner: options.includePartner === true,
      layerIds: options.layerIds,
      limit: options.limit ?? 250
    }),
    headers: {
      ...(authHeaders(token) ?? {}),
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function fetchUserProfile(apiBase: string, token: string): Promise<ServerUserProfile> {
  return fetchJson<ServerUserProfile>(`${apiBase}/api/v1/me/preferences`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export async function saveUserProfile(
  apiBase: string,
  token: string,
  payload: { alertPreferences?: AlertPreferences; preferences?: object }
): Promise<ServerUserProfile> {
  return fetchJson<ServerUserProfile>(`${apiBase}/api/v1/me/preferences`, {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "PUT"
  });
}

export async function acknowledgeCopAlert(apiBase: string, token: string, alertId: string, note?: string): Promise<CopAlert> {
  return fetchJson<CopAlert>(`${apiBase}/api/v1/cop/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
    body: JSON.stringify(note ? { note } : {}),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function fetchMessagingStatus(apiBase: string, token: string | undefined): Promise<MessagingStatusResponse> {
  return fetchJson<MessagingStatusResponse>(`${apiBase}/api/v1/messaging/status`, {
    headers: authHeaders(token)
  });
}

export function connectCopStream(apiBase: string, token: string | undefined, handlers: CopStreamHandlers): CopStreamConnection | null {
  if (typeof ReadableStream === "undefined") {
    return null;
  }

  const controller = new AbortController();
  void readCopStream(apiBase, token, controller.signal, handlers)
    .then(() => {
      if (!controller.signal.aborted) {
        handlers.onError(new Error("Živý stream situačních dat byl ukončen."));
      }
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted) {
        handlers.onError(error instanceof Error ? error : new Error("Živý stream situačních dat selhal."));
      }
    });

  return {
    close: () => controller.abort()
  };
}

export function filterVisibleObjects(objects: CopObject[], filters: CopDashboardFilters): CopObject[] {
  return objects.filter((object) => {
    if (!filters.includeSynthetic && object.synthetic) {
      return false;
    }
    return (object.confidence ?? 0) >= filters.minConfidence;
  });
}

export function filterObjectsByLayer(objects: CopObject[], layer: CopLayer): CopObject[] {
  if (layer === "uav") {
    return objects.filter((object) => object.objectType === "UAV");
  }
  if (layer === "friendly") {
    return objects.filter((object) => object.affiliation === "FRIEND" || object.affiliation === "ASSUMED_FRIEND");
  }
  if (layer === "foreign") {
    return objects.filter((object) => object.affiliation === "HOSTILE" || object.affiliation === "SUSPECT");
  }
  if (layer === "data-quality") {
    return objects.filter((object) => (object.confidence ?? 0) < 0.5);
  }
  if (layer === "public-flights") {
    return objects.filter(isPublicFlightObject);
  }
  if (layer === "sim-air") {
    return objects.filter(isSimulatedAirObject);
  }
  return objects;
}

export function filterObjectsByLayers(objects: CopObject[], layers: CopLayer[]): CopObject[] {
  const normalizedLayers = layers.filter((layer, index) => copLayerIds.includes(layer) && layers.indexOf(layer) === index);
  if (normalizedLayers.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  return normalizedLayers.flatMap((layer) =>
    filterObjectsByLayer(objects, layer).filter((object) => {
      if (seen.has(object.objectId)) {
        return false;
      }
      seen.add(object.objectId);
      return true;
    })
  );
}

export function getDataQualityCount(objects: CopObject[]): number {
  return objects.filter((object) => (object.confidence ?? 0) < 0.5).length;
}

export function getUavCount(objects: CopObject[]): number {
  return objects.filter((object) => object.objectType === "UAV").length;
}

export function getPublicFlightCount(objects: CopObject[]): number {
  return objects.filter(isPublicFlightObject).length;
}

export function getSimulatedAirCount(objects: CopObject[]): number {
  return objects.filter(isSimulatedAirObject).length;
}

export function isPublicFlightObject(object: CopObject): boolean {
  return object.attributes?.flightData !== undefined || object.attributes?.dataOrigin === "PUBLIC_FLIGHT_AGGREGATE";
}

export function isSimulatedAirObject(object: CopObject): boolean {
  if (isPublicFlightObject(object)) {
    return false;
  }
  const sourceSystemId = object.attributes?.provenance?.sourceSystemId?.toLowerCase() ?? "";
  return object.domain === "AIR" && (Boolean(object.synthetic) || sourceSystemId.includes("sim"));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || "API request failed"} for ${url}`);
  }
  return (await response.json()) as T;
}

async function fetchOptionalJson<T>(url: string, init?: RequestInit): Promise<T | undefined> {
  try {
    return await fetchJson<T>(url, init);
  } catch {
    return undefined;
  }
}

async function readCopStream(apiBase: string, token: string | undefined, signal: AbortSignal, handlers: CopStreamHandlers): Promise<void> {
  const response = await fetch(joinApiPath(apiBase, "/api/v1/stream/cop/live"), {
    headers: {
      Accept: "text/event-stream",
      ...authHeaders(token)
    },
    signal
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || "Živý stream selhal"}`);
  }
  if (!response.body) {
    throw new Error("Prohlížeč neposkytuje čitelný stream situačních dat.");
  }

  handlers.onOpen();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/u);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = readSseData(block);
      if (!data) {
        continue;
      }
      handlers.onMessage(JSON.parse(data) as CopStreamMessage);
    }
  }
}

function authHeaders(token: string | undefined): Record<string, string> | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function readSseData(block: string): string | null {
  const dataLines = block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

function joinApiPath(base: string, path: string): string {
  if (!base) {
    return path;
  }
  return `${base.replace(/\/$/u, "")}${path}`;
}
