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

export interface DemoScenarioStatus {
  bbox: {
    east: number;
    north: number;
    south: number;
    west: number;
  };
  demoScenarioId: string;
  description: string;
  eventId: string;
  label: string;
  status: "empty" | "ready";
  summary: {
    drawingCount: number;
    groupCount: number;
    reportCount: number;
  };
}

export interface DemoScenarioResponse {
  contractVersion: "cop-demo-scenarios-v1";
  generatedAt: string;
  operation?: Record<string, boolean | number | string>;
  scenario: DemoScenarioStatus;
}

export interface DemoScenarioListResponse {
  contractVersion: "cop-demo-scenarios-v1";
  generatedAt: string;
  items: DemoScenarioStatus[];
}

export interface AiCopResponse {
  auditId: string;
  model?: string;
  policy: {
    allowed: boolean;
    reason: string;
    redactionsApplied: boolean;
  };
  provider?: "openai" | "codex" | "ollama" | "local" | "mock";
  requestId: string;
  result: Record<string, unknown>;
  routing?: {
    complexityScore: number;
    embeddingModel?: string;
    fallbackModel?: string;
    modelRole: "fast" | "provider-default" | "reasoning";
    provider: "openai" | "codex" | "ollama" | "local" | "mock";
    reason: string;
    selectedModel: string;
    strategy: "deterministic-v1";
  };
  status: "COMPLETED" | "REJECTED" | "NEEDS_HUMAN_REVIEW";
}

export interface AiSituationSummaryOptions {
  includeAlerts?: boolean;
  language?: "cs" | "en";
  maxObjects?: number;
  requestId?: string;
}

export interface AiChatAgentQueryOptions {
  chatContext?: AiChatAgentContextSnapshot;
  conversationId?: string;
  groupId?: string;
  language?: "cs" | "en";
  maxObjects?: number;
  question: string;
  requestId?: string;
}

export interface AiChatAgentContextSnapshot {
  encrypted?: boolean;
  includedMessageCount?: number;
  messages?: AiChatAgentContextMessage[];
  roomId?: string;
  source?: "browser-visible-decrypted-timeline";
  visibleMessageCount?: number;
}

export interface AiChatAgentContextMessage {
  ai?: {
    auditId?: string;
    provider?: string;
    status?: string;
    type?: string;
  };
  body: string;
  eventId?: string;
  kind?: string;
  own?: boolean;
  sender?: string;
  senderDisplayName?: string;
  timestamp?: string;
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
  itinerary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  originCountry?: string;
  presentation?: {
    colorHex?: string;
    colorKey?: string;
    iconFile?: string;
    iconKey?: string;
    iconSet?: string;
    rotateWithHeading?: boolean;
    rotationDeg?: number;
    [key: string]: unknown;
  };
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
  route?: Record<string, unknown>;
  sources?: Array<{
    fetchedAt?: string;
    seenAt?: string;
    sourceId?: string;
    sourceRecordId?: string;
  }>;
  status?: Record<string, unknown>;
  trackId?: string;
  trackKey?: string;
  trackKeyKind?: "icao24" | "remote_id" | "radar_track" | "partner_track" | string;
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
  | "air_quality_grid"
  | "boundary_admin"
  | "boundary_country"
  | "boundary_district"
  | "boundary_municipality"
  | "boundary_orp"
  | "boundary_region"
  | "community"
  | "fire"
  | "flight_airports"
  | "flight_airspaces"
  | "flood"
  | "ground"
  | "mobile"
  | "mobile_coverage"
  | "mobile_network"
  | "mission_arena"
  | "place_settlements"
  | "traffic"
  | "warnings"
  | "weather_alerts"
  | "weather_forecast_area"
  | "weather_webcams"
  | "weather"
  | "weather_humidity_grid"
  | "weather_precipitation_grid"
  | "weather_pressure_grid"
  | "weather_radar_nowcast"
  | "weather_radar_precipitation"
  | "weather_radar_reflectivity"
  | "weather_temperature_grid"
  | "weather_thunderstorm_risk"
  | "weather_wind_field";
export type SafetyLayerId = "boundary_admin" | "fire" | "flood" | "warnings" | "weather_alerts";
export type TakLayerId = "ground" | "mobile" | "traffic";
export type SafetyDataSourceId = "admin_boundaries" | "chmi_alerts" | "chmi_hydro" | "fire_hotspots" | "fire_incidents" | "gdacs_alerts" | "hzs_incidents" | "mock" | "nasa_firms" | "road_srti_lod" | "weather_alerts";

export interface MapBounds {
  east: number;
  north: number;
  south: number;
  west: number;
}

export type SketchDrawingKind = "arrow" | "circle" | "line" | "marker" | "measurement" | "point" | "polygon" | "text";
export type SketchDrawingVisibility = "event" | "group" | "private" | "public";
export type SketchPaletteMode = "civil" | "professional";

export type SketchGeometry =
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<[number, number]>; type: "LineString" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface SketchDrawingFeature {
  geometry: SketchGeometry;
  id: string;
  properties: {
    createdAt: string;
    drawingId: string;
    eventId?: string;
    groupId?: string;
    kind: SketchDrawingKind;
    label: string;
    locked: boolean;
    ownerDisplayName: string;
    ownerSubjectId: string;
    ownerUsername: string;
    properties: Record<string, unknown>;
    revision: number;
    style: {
      fill: string;
      lineWidth: number;
      opacity: number;
      stroke: string;
    };
    symbol: {
      iconId?: string;
      palette: SketchPaletteMode;
      sidc?: string;
    };
    updatedAt: string;
    visibility: SketchDrawingVisibility;
  };
  type: "Feature";
}

export interface SketchDrawingFeatureCollection {
  contractVersion: "cop-sketch-drawings-v1";
  features: SketchDrawingFeature[];
  generatedAt: string;
  summary: {
    featureCount: number;
  };
  type: "FeatureCollection";
}

export interface SketchDrawingPayload {
  eventId?: string | null;
  geometry?: SketchGeometry;
  groupId?: string | null;
  kind?: SketchDrawingKind;
  label?: string;
  locked?: boolean;
  properties?: Record<string, unknown>;
  style?: Partial<SketchDrawingFeature["properties"]["style"]>;
  symbol?: Partial<SketchDrawingFeature["properties"]["symbol"]>;
  visibility?: SketchDrawingVisibility;
}

export interface SketchPaletteResponse {
  contractVersion: "cop-sketch-palettes-v1";
  generatedAt: string;
  modes: Partial<Record<SketchPaletteMode, {
    label: string;
    symbols: Array<{
      iconId: string;
      label: string;
      sidc?: string;
      tone?: string;
    }>;
  }>>;
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
  | { coordinates: Array<Array<Array<[number, number]>>>; type: "MultiPolygon" }
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<[number, number]>; type: "LineString" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface SituationFeatureProperties {
  adminLevel?: number | string;
  affectedArea?: string;
  affectedAreas?: string[];
  areaName?: string;
  affiliation?: string;
  attachments?: Array<{
    access?: Record<string, unknown>;
    accessDenied?: boolean;
    attachmentId: string;
    byteSize: number;
    contentType: string;
    contentUrl?: string;
    derivatives?: CommunityAttachmentDerivative[];
    fileName?: string;
    kind: CommunityAttachmentKind;
    metadata?: Record<string, unknown>;
    uploadedAt?: string;
  }>;
  category: string;
  certainty?: string;
  confidence?: number;
  assumptions?: Record<string, unknown>;
  btsStatus?: string;
  btsStatusSource?: string;
  dataQuality?: string;
  demSource?: string;
  description?: string;
  detailUrl?: string;
  discharge?: number;
  effectiveAt?: string;
  disclaimer?: string;
  estimatedSignalDbm?: number;
  expiresAt?: string;
  featureId: string;
  fireStatus?: string;
  floodStage?: number;
  forecastAvailable?: boolean;
  forecastUntil?: string;
  generatedAt?: string;
  geocodes?: Array<{ scheme: string; value: string }>;
  geometryMode?: string;
  groupId?: string | null;
  groupName?: string | null;
  hazardType?: string;
  hazardSeverity?: string;
  headline?: string;
  iconHint?: string;
  localized?: Record<string, unknown>;
  label: string;
  layer: SituationLayerId;
  layerId?: string;
  license?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  modelVersion?: string;
  basis?: string[];
  basin?: string;
  catchmentAreaKm2?: number;
  notices?: string[];
  animation?: Record<string, unknown>;
  aggregate?: number;
  aggregateDelta?: number;
  eventLog?: Array<Record<string, unknown>>;
  featureRole?: "mission_state" | "task_state" | "team_state" | string;
  gameState?: Record<string, unknown>;
  integrationMode?: string;
  missionId?: string;
  missionPackId?: string;
  observedAt?: string;
  operator?: string;
  operatorStatusAvailable?: boolean;
  participantCount?: number;
  phase?: string;
  providerId?: string;
  providerLayerId?: string;
  providerProperties?: Record<string, unknown>;
  quality?: string;
  readModel?: boolean;
  receivedAt?: string;
  recommendedAction?: string;
  rendering?: Record<string, unknown>;
  reportId?: string;
  resolutionM?: number;
  riverName?: string;
  runtimeMode?: string;
  score?: Record<string, number>;
  scoreDelta?: Record<string, number>;
  severity?: string;
  source?: string;
  sourceCode?: string;
  sourceId: string;
  sourceIncident?: string;
  sourceSystem?: string;
  sourceName?: string;
  sourceRevision?: string;
  stale?: boolean;
  stationId?: string;
  status?: string;
  story?: Record<string, unknown>;
  styleHint?: string;
  summary?: string;
  tags?: Record<string, unknown>;
  tasking?: Array<Record<string, unknown>>;
  teamColor?: string;
  teamId?: string;
  teamLabel?: string;
  teamScores?: MissionArenaTeamScore[];
  technology?: string;
  timelineUrl?: string;
  totalVotes?: number;
  trend?: string;
  typeCode?: string;
  urgency?: string;
  updatedAt?: string;
  validFrom?: string;
  validUntil?: string;
  voteCount?: number;
  waterTemperatureC?: number;
  waterLevelCm?: number;
}

export interface WeatherRadarFrame {
  boundsWgs84?: [number, number, number, number];
  cleanUrl?: string;
  dataBoundsWgs84?: [number, number, number, number];
  fileName?: string;
  observedAt?: string;
  opacity?: number;
  productId?: string;
  url?: string;
  warnings?: string[];
}

export interface WeatherRadarFramesProduct {
  frames: WeatherRadarFrame[];
  product?: string;
  productId?: string;
  warnings?: string[];
}

export interface WeatherRadarFramesResponse {
  frames?: WeatherRadarFrame[];
  generatedAt?: string;
  product?: string;
  products?: WeatherRadarFramesProduct[];
  warnings?: string[];
}

export interface WeatherDisplayPresentation {
  authoritativeCondition?: boolean;
  badgeLabel?: string;
  badgeLabelEn?: string;
  badgeTone?: string;
  chartUrl?: string;
  confidence?: number;
  confidencePercent?: number;
  conditionMode?: "estimated" | "measured" | "observed" | "unclassified" | string;
  detailUrl?: string;
  detailType?: string;
  iconKey?: string;
  iconSet?: string;
  label?: string;
  primaryValue?: string;
  renderer?: string;
  secondaryValue?: string;
  subtitle?: string;
  tertiaryValue?: string;
  title?: string;
}

export interface WeatherStationChartPoint {
  time?: string;
  at?: string;
  t?: string;
  value?: number;
  v?: number;
}

export interface WeatherStationChartSeries {
  color?: string;
  id?: string;
  key?: string;
  label?: string;
  labelCs?: string;
  labelEn?: string;
  points?: WeatherStationChartPoint[];
  role?: string;
  seriesId?: string;
  source?: string;
  style?: string;
  unit?: string;
}

export interface WeatherStationChart {
  chartId?: string;
  id?: string;
  labelCs?: string;
  preferredType?: string;
  series?: WeatherStationChartSeries[];
  title?: string;
  titleCs?: string;
  titleEn?: string;
  unit?: string;
  xField?: string;
  yUnit?: string;
  yAxis?: {
    label?: string;
    unit?: string;
  };
}

export interface WeatherStationAttribution {
  label?: string;
  role?: string;
  sourceId?: string;
}

export interface WeatherStationDetailResponse {
  attribution?: string | WeatherStationAttribution[];
  charts?: WeatherStationChart[];
  contractVersion?: string;
  current?: {
    display?: WeatherDisplayPresentation;
    metrics?: Record<string, unknown>;
    observedAt?: string;
    severity?: string;
    validUntil?: string;
  };
  forecast?: {
    from?: string;
    pointCount?: number;
    points?: Array<Record<string, unknown>>;
    to?: string;
  };
  generatedAt?: string;
  history?: {
    from?: string;
    pointCount?: number;
    points?: Array<Record<string, unknown>>;
    to?: string;
  };
  station?: Record<string, unknown>;
  warnings?: string[];
}

export interface WeatherForecastAreaDetailResponse {
  area?: Record<string, unknown>;
  areaId?: string;
  attribution?: string | WeatherStationAttribution[];
  charts?: WeatherStationChart[];
  contractVersion?: string;
  current?: {
    display?: WeatherDisplayPresentation;
    metrics?: Record<string, unknown>;
    observedAt?: string;
    severity?: string;
    validUntil?: string;
  };
  daily?: {
    from?: string;
    pointCount?: number;
    points?: Array<Record<string, unknown>>;
    to?: string;
  };
  generatedAt?: string;
  hourly?: {
    from?: string;
    pointCount?: number;
    points?: Array<Record<string, unknown>>;
    to?: string;
  };
  nowcast?: {
    from?: string;
    pointCount?: number;
    points?: Array<Record<string, unknown>>;
    to?: string;
  };
  summary?: string | Record<string, unknown>;
  warnings?: string[];
}

export interface TransitStopTime {
  delaySeconds?: number;
  distanceMeters?: number;
  name?: string;
  plannedArrival?: string;
  plannedDeparture?: string;
  position?: {
    lat?: number;
    lon?: number;
  };
  realtimeArrival?: string;
  realtimeDeparture?: string;
  relationToVehicle?: string;
  scheduledArrival?: string;
  scheduledDeparture?: string;
  sequence?: number;
  status?: string;
  stopId?: string;
  stopName?: string;
  stopSequence?: number;
}

export interface TransitVehicleDetailResponse {
  contractVersion?: string;
  generatedAt?: string;
  current?: {
    delaySeconds?: number;
    display?: {
      badgeLabel?: string;
      badgeTone?: string;
      label?: string;
      primaryValue?: string;
      secondaryValue?: string;
      subtitle?: string;
      title?: string;
    };
    headingDeg?: number;
    observedAt?: string;
    speedMps?: number;
    status?: string;
  };
  featureId?: string;
  providerId?: string;
  quality?: {
    generatedFrom?: string[];
    realtimeVehicleAvailable?: boolean;
    routeShapeAvailable?: boolean;
    shapeAvailable?: boolean;
    stale?: boolean;
    staticModelAvailable?: boolean;
    tripScheduleAvailable?: boolean;
    tripUpdateAvailable?: boolean;
    vehiclePositionAvailable?: boolean;
    warnings?: string[];
  };
  route?: {
    color?: string;
    destination?: string;
    direction?: string;
    routeId?: string;
    routeLongName?: string;
    routeShortName?: string;
    shape?: unknown;
    transportMode?: string;
  };
  routeShape?: {
    coordinates?: unknown;
    shapeId?: string;
    truncated?: boolean;
    type?: string;
  };
  sourceId?: string;
  serviceAlerts?: Array<Record<string, unknown>>;
  stops?: TransitStopTime[];
  stopTimes?: TransitStopTime[];
  summary?: Record<string, unknown>;
  systemId?: string;
  alerts?: Array<Record<string, unknown>>;
  trip?: {
    destination?: string;
    destinationStop?: TransitStopTime;
    directionId?: string;
    headsign?: string;
    nextStop?: TransitStopTime;
    originStop?: TransitStopTime;
    previousStop?: TransitStopTime;
    routeId?: string;
    routeLongName?: string;
    routeShortName?: string;
    serviceDate?: string;
    startDate?: string;
    startTime?: string;
    status?: string;
    tripId?: string;
    vehicleId?: string;
  };
  vehicle?: {
    confidence?: number;
    currentStatus?: string;
    currentStopSequence?: number;
    dataAgeSeconds?: number;
    delaySeconds?: number;
    destination?: string;
    id?: string;
    label?: string;
    licensePlate?: string;
    mode?: string;
    operator?: string;
    occupancyPercent?: number;
    occupancyStatus?: string;
    observedAt?: string;
    position?: {
      headingDeg?: number;
      lat?: number;
      lon?: number;
      observedAt?: string;
      speedMps?: number;
    };
    routeShortName?: string;
    status?: string;
    systemId?: string;
    transportMode?: string;
    type?: string;
    vehicleId?: string;
  };
  warnings?: string[];
}

export interface TransitStopDeparture {
  delaySeconds?: number;
  destination?: string;
  headsign?: string;
  platform?: string;
  plannedDeparture?: string;
  realtimeDeparture?: string;
  routeId?: string;
  routeShortName?: string;
  status?: string;
  tripId?: string;
  transportMode?: string;
}

export interface TransitStopRoute {
  destination?: string;
  headsign?: string;
  routeId?: string;
  routeLongName?: string;
  routeShortName?: string;
  transportMode?: string;
}

export interface TransitStopDetailResponse {
  contractVersion?: string;
  departures?: TransitStopDeparture[];
  generatedAt?: string;
  providerId?: string;
  quality?: {
    departuresAvailable?: boolean;
    generatedFrom?: string[];
    realtimeAvailable?: boolean;
    stale?: boolean;
    staticModelAvailable?: boolean;
    warnings?: string[];
  };
  routes?: TransitStopRoute[];
  serviceAlerts?: Array<Record<string, unknown>>;
  sourceId?: string;
  stop?: {
    detailAvailable?: boolean;
    display?: {
      badgeLabel?: string;
      label?: string;
      primaryValue?: string;
      secondaryValue?: string;
      subtitle?: string;
      title?: string;
    };
    lat?: number;
    lon?: number;
    name?: string;
    platform?: string;
    stopId?: string;
    stopName?: string;
    systemId?: string;
    zoneId?: string;
  };
  stopId?: string;
  summary?: Record<string, unknown>;
  systemId?: string;
  warnings?: string[];
}

export type MobileCoverageTechnology = "2G" | "4G" | "5G";

export interface MobileTowerViewshedFeature {
  geometry: SituationGeometry;
  id?: string | number;
  properties: Record<string, unknown>;
  type: "Feature";
}

export interface MobileTowerViewshedResponse {
  contractVersion: "sim-mobile-coverage-tower-viewshed-v1";
  features: MobileTowerViewshedFeature[];
  generatedAt?: string;
  providerId?: string;
  summary?: Record<string, unknown>;
  tower?: Record<string, unknown>;
  type: "FeatureCollection";
  warnings: string[];
}

export interface RadioProfile {
  antennaGainDbi?: number;
  antennaHeightM: number;
  frequencyMhz: number;
  maxRadiusM: number;
  name: string;
  profileId?: string;
  receiverHeightM: number;
  receiverSensitivityDbm?: number;
  requiredFresnelClearancePct?: number;
  systemLossDb?: number;
  txPowerW?: number;
}

export interface RadioProfilesResponse {
  contractVersion?: string;
  generatedAt?: string;
  profiles: RadioProfile[];
  warnings: string[];
}

export interface RadioPoint {
  antennaHeightM?: number;
  lat: number;
  lon: number;
  receiverHeightM?: number;
}

export interface RadioCoverageRequest {
  azimuthStepDeg?: number;
  distanceStepM?: number;
  profile?: RadioProfile;
  profileId?: string;
  radioName?: string;
  radiusM?: number;
  station: RadioPoint;
}

export interface RadioLinkCheckRequest {
  from: RadioPoint;
  profile?: RadioProfile;
  profileId?: string;
  radioName?: string;
  to: RadioPoint;
}

export interface RadioSiteSearchRequest {
  gridStepM?: number;
  maxCandidates?: number;
  profile?: RadioProfile;
  profileId?: string;
  radioName?: string;
  searchArea: {
    bbox: [number, number, number, number];
  };
  targets: RadioPoint[];
}

export interface RadioFeatureCollectionResponse {
  contractVersion?: string;
  features: MobileTowerViewshedFeature[];
  generatedAt?: string;
  metadata?: Record<string, unknown>;
  providerId?: string;
  summary?: Record<string, unknown>;
  type: "FeatureCollection";
  warnings: string[];
}

export interface RadioLinkCheckResponse {
  azimuthDeg?: number;
  contractVersion?: string;
  distanceM?: number;
  fresnelClearancePct?: number;
  generatedAt?: string;
  linkStatus?: "clear" | "marginal" | "obstructed" | "unknown" | string;
  maxObstructionM?: number;
  metadata?: Record<string, unknown>;
  profile?: RadioProfile | Record<string, unknown>;
  profileSamples?: Array<Record<string, unknown>>;
  requiredExtraAntennaHeightM?: number;
  summary?: Record<string, unknown>;
  warnings: string[];
}

export interface MissionArenaTeamScore {
  aggregate?: number;
  aggregateDelta?: number;
  color?: string;
  label: string;
  rank?: number;
  score?: Record<string, number>;
  scoreDelta?: Record<string, number>;
  teamId: string;
  totalVotes?: number;
}

export interface MissionArenaFeatureCollectionResponse {
  contractVersion: "cop-mission-arena-source-v1";
  features: SituationFeature[];
  generatedAt: string;
  query: {
    bbox: MapBounds;
    layers: ["presentation.mission_arena"];
    limit: number;
  };
  source: {
    generatedAt?: string;
    sourceId: "mission-arena-api";
    sourceType: "MISSION_ARENA_PRESENTATION";
  };
  sourceHealth?: SourceHealthOverride;
  sources: Array<{
    baseUrl?: string;
    enabled?: boolean;
    label?: string;
    layers?: ["presentation.mission_arena"];
    mode?: string;
    sourceId: "mission_arena_runtime";
    updateCadenceSeconds?: number;
  }>;
  summary: {
    featureCount: number;
    missionStateCount: number;
    sourceCount: number;
    staleFeatureCount: number;
    teamStateCount: number;
    warningCount: number;
  };
  type: "FeatureCollection";
  warnings: string[];
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
  | { coordinates: Array<Array<Array<[number, number]>>>; type: "MultiPolygon" }
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface SafetyFeatureProperties {
  adminLevel?: number | string;
  affectedArea?: string;
  affectedAreas?: string[];
  areaName?: string;
  basis?: string[];
  basin?: string;
  catchmentAreaKm2?: number;
  category: string;
  certainty?: string;
  confidence?: number;
  description?: string;
  detailUrl?: string;
  discharge?: number;
  effectiveAt?: string;
  expiresAt?: string;
  featureId: string;
  fireStatus?: string;
  floodStage?: number;
  forecastAvailable?: boolean;
  forecastUntil?: string;
  geocodes?: Array<{ scheme: string; value: string }>;
  geometryMode?: string;
  hazardType?: string;
  headline: string;
  iconHint?: string;
  localized?: Record<string, unknown>;
  layer: SafetyLayerId;
  layerId?: string;
  license?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  observedAt?: string;
  providerId?: string;
  providerLayerId?: string;
  providerProperties?: Record<string, unknown>;
  recommendedAction?: string;
  riverName?: string;
  severity?: string;
  source?: string;
  sourceCode?: string;
  sourceId: string;
  sourceIncident?: string;
  sourceSystem?: string;
  sourceName?: string;
  stale?: boolean;
  stationId?: string;
  status?: string;
  styleHint?: string;
  tags?: Record<string, unknown>;
  timelineUrl?: string;
  trend?: string;
  typeCode?: string;
  updatedAt?: string;
  urgency?: string;
  validFrom?: string;
  validUntil?: string;
  waterTemperatureC?: number;
  waterLevelCm?: number;
}

export type HydroSeriesId = "H" | "Q" | "TH" | "H_F" | "Q_F";

export interface HydroStationDetailPoint {
  at: string;
  ingestedAt: string;
  source: "live_now" | "local_history" | "recent_backfill";
  value: number;
}

export interface HydroStationDetailSeries {
  id: HydroSeriesId;
  label: string;
  points: HydroStationDetailPoint[];
  role: "forecast" | "observation";
  unit: string;
}

export interface HydroStationDetailResponse {
  chart: {
    currentTime: string;
    panels: Array<{
      forecastSeriesIds?: HydroSeriesId[];
      id: "discharge" | "temperature" | "water_level";
      seriesIds: HydroSeriesId[];
      thresholdSet?: "discharge" | "waterLevel";
      title: string;
      yAxis: {
        label: string;
        unit: string;
      };
    }>;
    title: string;
  };
  contractVersion: "chmi-hydro-station-detail-v1";
  generatedAt: string;
  providerId: "sim.safety-data";
  series: HydroStationDetailSeries[];
  sourceId: "chmi_hydro";
  station: {
    catchmentAreaKm2?: number;
    hydrologicalOrder?: string;
    lat: number;
    lon: number;
    spaType?: string;
    stationCode?: string;
    stationId: string;
    stationName: string;
    streamName?: string;
  };
  thresholds: {
    discharge: {
      dry?: number;
      spa1?: number;
      spa2?: number;
      spa3?: number;
      spa4?: number;
      unit: "m3/s";
    };
    waterLevel: {
      dry?: number;
      spa1?: number;
      spa2?: number;
      spa3?: number;
      spa4?: number;
      unit: "cm";
    };
  };
  warnings: string[];
  window: {
    from: string;
    to: string;
  };
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

export type CommunityReportCategory =
  | "bridge_damage"
  | "fire"
  | "flood"
  | "hazard"
  | "infrastructure_damage"
  | "medical"
  | "other"
  | "road_blockage"
  | "utility_outage";

export type CommunityReportHazardSeverity = "advisory" | "critical" | "warning";
export type CommunityReportVisibility = "community" | "private" | "public";
export type CommunityAttachmentKind = "document" | "photo" | "video";
export type CommunityVideoSpatialMode = "apple_mv_hevc" | "none" | "over_under" | "side_by_side";
export type CommunityMediaAccessMode = "groups" | "private" | "public" | "users";
export type CommunityGroupVisibility = "private" | "public";
export type CommunityGroupMemberRole = "admin" | "member" | "owner";
export type CommunityGroupMemberStatus = "active" | "left" | "pending";

export interface CommunityMediaAccessPolicy {
  audience: CommunityMediaAccessMode;
  groupIds?: string[];
  userSubjectIds?: string[];
}

export interface CommunityReportLocation {
  accuracyM?: number;
  lat: number;
  lon: number;
  source: "device" | "manual" | "media_metadata" | "photo_exif" | "unknown";
}

export interface CommunityReportAttachment {
  access?: Record<string, unknown>;
  accessDenied?: boolean;
  attachmentId: string;
  byteSize: number;
  captureLocation?: CommunityReportLocation;
  contentType: string;
  contentUrl?: string;
  derivatives?: CommunityAttachmentDerivative[];
  fileName?: string;
  kind: CommunityAttachmentKind;
  metadata?: Record<string, unknown>;
  reportId: string;
  status: "failed" | "pending_upload" | "removed" | "uploaded";
}

export interface CommunityAttachmentDerivative {
  byteSize?: number;
  contentType?: string;
  contentUrl?: string;
  derivativeId: "xr-sbs";
  error?: string;
  kind: "video";
  layout: "side_by_side";
  status: "failed" | "processing" | "queued" | "ready";
  updatedAt: string;
}

export interface CommunityGroupMember {
  displayName: string;
  joinedAt?: string;
  requestedAt: string;
  role: CommunityGroupMemberRole;
  status: CommunityGroupMemberStatus;
  subjectId: string;
  username: string;
}

export interface CommunityGroup {
  anchorLocation?: CommunityReportLocation;
  createdAt: string;
  createdBy: {
    displayName: string;
    subjectId: string;
    username: string;
  };
  description?: string;
  groupId: string;
  metadata?: Record<string, unknown>;
  members: CommunityGroupMember[];
  name: string;
  updatedAt: string;
  visibility: CommunityGroupVisibility;
}

export interface CommunityReport {
  attachments: CommunityReportAttachment[];
  category: CommunityReportCategory;
  createdBy?: {
    displayName: string;
    subjectId: string;
    username: string;
  };
  description?: string;
  location: CommunityReportLocation;
  observedAt: string;
  properties: Record<string, unknown>;
  reportId: string;
  status: "draft" | "hidden" | "published" | "rejected" | "submitted";
  title: string;
  visibility: CommunityReportVisibility;
}

export interface CommunityAttachmentUploadSlot {
  bucket: string;
  expiresAt: string;
  headers: Record<string, string>;
  method: "PUT";
  objectKey: string;
  uploadUrl: string;
}

export type CommunityAttachmentUploadPhase = "direct" | "proxy";

export interface CommunityAttachmentUploadProgress {
  lengthComputable: boolean;
  loaded: number;
  phase: CommunityAttachmentUploadPhase;
  total: number;
}

export type CommunityAttachmentUploadProgressHandler = (progress: CommunityAttachmentUploadProgress) => void;

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
export type MapCatalogLayerKind = "aggregate" | "grid_field" | "mvt_tiles" | "raster_overlay" | "raster_tiles" | "static_reference" | "track_stream" | "user_objects" | "vector_features" | "vector_field";
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
  mode: "bbox" | "grid" | "internal" | "stream" | "tile";
  providerId: string;
  providerLayerIds?: string[];
  providerSourceIds?: string[];
  streamId: string;
}

export interface MapCatalogLayer {
  audience: MapCatalogAudience;
  availability?: string;
  cacheTtlSeconds?: number;
  compatibilityOnly?: boolean;
  defaultVisible: boolean;
  description?: string;
  disabledReason?: string;
  enabled?: boolean;
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
  preferredProviderId?: string;
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
  availability?: string;
  cacheTtlSeconds?: number;
  compatibilityOnly?: boolean;
  disabledReason?: string;
  enabled: boolean;
  feedsCatalogLayerIds?: string[];
  label: string;
  preferredProviderId?: string;
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
  missionArena?: MissionArenaFeatureCollectionResponse;
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

export interface PlaceGeocodeResult {
  bbox?: MapBounds;
  center: [number, number];
  displayName: string;
  id: string;
  importance?: number;
  kind?: string;
  providerId: string;
  subtitle?: string;
  zoomHint?: number;
}

export interface PlaceGeocodeResponse {
  cache: {
    key: string;
    status: "disabled" | "hit" | "miss";
    ttlSeconds: number;
  };
  contractVersion: "cop-geocode-v1";
  items: PlaceGeocodeResult[];
  providerId: string;
  query: {
    language: string;
    limit: number;
    q: string;
  };
  serverTimestamp: string;
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
  polygon?: AoiPolygon;
  radiusKm: number;
  severity?: CopAlertSeverity;
}

export interface AoiPolygon {
  type: "Polygon";
  coordinates: Array<Array<[number, number]>>;
}

export interface ServerUserProfile {
  actor: CopActor;
  alertPreferences: AlertPreferences;
  preferences: Record<string, unknown>;
  updatedAt: string | null;
}

export type MobilePairingStatus = "pending" | "claimed" | "confirmed" | "expired" | "revoked";
export type MobileDeviceStatus = "paired" | "revoked";

export interface MobilePairingDeviceSummary {
  appVersion: string;
  buildNumber?: string | null;
  capabilities?: string[];
  deviceId: string;
  deviceModel?: string | null;
  matrixDeviceId?: string | null;
  osVersion?: string | null;
  platform: "ios" | "ipados";
  pushTokenRegistered: boolean;
}

export interface MobilePairingActorSummary {
  displayName: string;
  subjectId: string;
  username: string;
}

export interface MobileDeviceRecord extends MobilePairingDeviceSummary {
  capabilities: string[];
  lastSeenAt: string;
  pairedAt: string;
  pairingCode?: string;
  revokedAt?: string;
  status: MobileDeviceStatus;
  subjectId: string;
}

export interface MobilePairingSessionResponse {
  contractVersion: "cop-mobile-pairing-v1";
  device: MobileDeviceRecord | null;
  pairing: {
    claimedAt: string | null;
    claimedBy: MobilePairingActorSummary | null;
    claimedDevice: MobilePairingDeviceSummary | null;
    code: string;
    confirmedAt: string | null;
    createdAt: string;
    createdBy: MobilePairingActorSummary;
    expiresAt: string;
    links: {
      customSchemeUrl: string;
      universalLink: string;
    };
    status: MobilePairingStatus;
  };
  policy: Record<string, unknown>;
  security: {
    confirmationRequired: boolean;
    containsAccessToken: false;
    containsRecoveryKey: false;
    containsRoomKeys: false;
  };
  serverTimestamp: string;
}

export interface MobileDevicesResponse {
  actor: CopActor;
  contractVersion: "cop-mobile-devices-v1";
  devices: MobileDeviceRecord[];
  policy: Record<string, unknown>;
  serverTimestamp: string;
}

export interface UserDirectoryEntry {
  displayName: string;
  email?: string;
  subjectId: string;
  username: string;
}

export interface UserDirectorySearchResponse {
  contractVersion: "cop-user-directory-v1";
  items: UserDirectoryEntry[];
  serverTimestamp: string;
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

export interface MessagingBootstrapResponse {
  accessToken?: string;
  chatAvailable: boolean;
  contractVersion: "cop-messaging-bootstrap-v1";
  detail?: string;
  deviceId?: string;
  e2eeRequired?: boolean;
  enabled: boolean;
  expiresAt?: string;
  homeserverBaseUrl?: string;
  providerId: "csm.messaging";
  serverName?: string;
  status: "degraded" | "disabled" | "online";
  tokenAvailable: boolean;
  userId?: string;
  warnings: string[];
}

export interface MessagingConversationSummary {
  avatarDataUrl?: string;
  avatarUrl?: string;
  conversationId: string;
  createdAt?: string;
  disclaimer?: string;
  directPeer?: {
    avatarUrl?: string;
    displayName?: string;
    userId: string;
  };
  e2eeRequired?: boolean;
  encrypted?: boolean;
  mapLinkCount?: number;
  matrix?: {
    homeserverBaseUrl?: string;
    roomId?: string | null;
    serverName?: string;
    state?: string;
  };
  memberCount?: number;
  members?: Array<{
    avatarUrl?: string;
    displayName?: string;
    role?: string;
    userId: string;
  }>;
  metadata?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
  status?: string;
  title: string;
  type: "direct" | "group";
  updatedAt?: string;
}

export interface MessagingConversationListResponse {
  contractVersion: "cop-messaging-conversations-v1";
  conversations: MessagingConversationSummary[];
  count: number;
  enabled: boolean;
  providerId: "csm.messaging";
  status: "degraded" | "disabled" | "online";
  warnings: string[];
}

export interface MessagingConversationCreateResponse {
  contractVersion: "cop-messaging-conversations-v1";
  conversation?: MessagingConversationSummary;
  enabled: boolean;
  providerId: "csm.messaging";
  status: "degraded" | "disabled" | "online";
  warnings: string[];
}

export interface MessagingMatrixIdentityResolutionResponse {
  contractVersion: "cop-messaging-identities-v1";
  enabled: boolean;
  identities: Array<{
    avatarUrl?: string;
    displayName?: string;
    matrixUserId: string;
    userId: string;
  }>;
  providerId: "csm.messaging";
  status: "degraded" | "disabled" | "online";
  warnings: string[];
}

export interface MessagingMatrixRoomBindingResponse {
  contractVersion: "cop-messaging-room-binding-v1";
  conversation?: MessagingConversationSummary;
  enabled: boolean;
  providerId: "csm.messaging";
  status: "degraded" | "disabled" | "online";
  warnings: string[];
}

export interface MessagingConversationMemberSyncResponse {
  contractVersion: "cop-messaging-conversations-v1";
  conversation?: MessagingConversationSummary;
  enabled: boolean;
  providerId: "csm.messaging";
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

export type IncidentCategory =
  | "community"
  | "fire"
  | "flood"
  | "infrastructure"
  | "medical"
  | "other"
  | "security"
  | "traffic"
  | "weather";
export type IncidentSeverity = "advisory" | "critical" | "info" | "warning";
export type IncidentStatus = "active" | "candidate" | "closed" | "monitoring" | "rejected" | "resolved";
export type IncidentLocationSource = "community_report" | "fusion" | "manual" | "provider";
export type IncidentSourceRefKind = "alert" | "community_report" | "manual" | "provider_feature" | "sketch";
export type IncidentTaskPriority = "high" | "low" | "normal" | "urgent";
export type IncidentTaskStatus = "blocked" | "cancelled" | "done" | "in_progress" | "open";

export interface IncidentActor {
  displayName: string;
  subjectId: string;
  username: string;
}

export interface IncidentLocation {
  accuracyM?: number;
  label?: string;
  lat: number;
  lon: number;
  source: IncidentLocationSource;
}

export interface IncidentSourceRef {
  id: string;
  kind: IncidentSourceRefKind;
  observedAt?: string;
  sourceId?: string;
  title?: string;
}

export interface IncidentRecord {
  category: IncidentCategory;
  confidence: number;
  createdAt: string;
  createdBy: IncidentActor;
  description?: string;
  incidentId: string;
  location: IncidentLocation;
  properties: Record<string, unknown>;
  provenance: Array<Record<string, unknown>>;
  severity: IncidentSeverity;
  sourceRefs: IncidentSourceRef[];
  status: IncidentStatus;
  title: string;
  updatedAt: string;
  updatedBy?: IncidentActor;
}

export interface IncidentTaskRecord {
  assigneeSubjectId?: string;
  createdAt: string;
  createdBy: IncidentActor;
  description?: string;
  dueAt?: string;
  incidentId: string;
  priority: IncidentTaskPriority;
  properties: Record<string, unknown>;
  sourceRef?: IncidentSourceRef;
  status: IncidentTaskStatus;
  taskId: string;
  title: string;
  updatedAt: string;
  updatedBy?: IncidentActor;
}

export interface IncidentFusionSuggestion {
  category: IncidentCategory;
  confidence: number;
  description?: string;
  explanation: string;
  location: IncidentLocation;
  metrics: {
    maxDistanceM: number;
    reportCount: number;
    timeSpanSeconds: number;
  };
  properties: Record<string, unknown>;
  reportIds: string[];
  severity: IncidentSeverity;
  sourceRefs: IncidentSourceRef[];
  suggestionId: string;
  title: string;
}

export interface IncidentListResponse {
  contractVersion: "cop-incidents-v1";
  featureCollection: unknown;
  items: IncidentRecord[];
  serverTimestamp: string;
}

export interface IncidentFusionSuggestionResponse {
  contractVersion: "cop-incident-fusion-suggestions-v1";
  generatedAt: string;
  items: IncidentFusionSuggestion[];
  sourceReportCount: number;
}

export interface IncidentTaskListResponse {
  contractVersion: "cop-incident-tasks-v1";
  incidentId: string;
  items: IncidentTaskRecord[];
  serverTimestamp: string;
}

export interface IncidentCreatePayload {
  category: IncidentCategory;
  confidence?: number;
  description?: string;
  location: IncidentLocation;
  properties?: Record<string, unknown>;
  provenance?: Array<Record<string, unknown>>;
  severity: IncidentSeverity;
  sourceRefs?: IncidentSourceRef[];
  status?: IncidentStatus;
  title: string;
}

export interface IncidentUpdatePayload {
  category?: IncidentCategory;
  confidence?: number;
  description?: string;
  location?: IncidentLocation;
  properties?: Record<string, unknown>;
  provenance?: Array<Record<string, unknown>>;
  severity?: IncidentSeverity;
  sourceRefs?: IncidentSourceRef[];
  status?: IncidentStatus;
  title?: string;
}

export interface IncidentTaskCreatePayload {
  assigneeSubjectId?: string;
  description?: string;
  dueAt?: string;
  priority?: IncidentTaskPriority;
  properties?: Record<string, unknown>;
  sourceRef?: IncidentSourceRef;
  status?: IncidentTaskStatus;
  title: string;
}

export interface IncidentTaskUpdatePayload {
  assigneeSubjectId?: string;
  description?: string;
  dueAt?: string | null;
  priority?: IncidentTaskPriority;
  properties?: Record<string, unknown>;
  sourceRef?: IncidentSourceRef;
  status?: IncidentTaskStatus;
  title?: string;
}

export interface IncidentFusionSuggestionOptions {
  bbox?: MapBounds;
  includeSingletons?: boolean;
  limit?: number;
  radiusM?: number;
  timeWindowSeconds?: number;
}

export interface IncidentListOptions {
  bbox?: MapBounds;
  categories?: IncidentCategory[];
  includeClosed?: boolean;
  limit?: number;
  statuses?: IncidentStatus[];
}

export interface IncidentTaskListOptions {
  limit?: number;
  statuses?: IncidentTaskStatus[];
}

export async function fetchIncidentFusionSuggestions(
  apiBase: string,
  token: string | undefined,
  options: IncidentFusionSuggestionOptions = {}
): Promise<IncidentFusionSuggestionResponse> {
  const query = new URLSearchParams();
  appendMapBoundsQuery(query, options.bbox);
  if (options.includeSingletons !== undefined) {
    query.set("includeSingletons", String(options.includeSingletons));
  }
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  if (options.radiusM !== undefined) {
    query.set("radiusM", String(options.radiusM));
  }
  if (options.timeWindowSeconds !== undefined) {
    query.set("timeWindowSeconds", String(options.timeWindowSeconds));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchJson<IncidentFusionSuggestionResponse>(`${apiBase}/api/v1/incidents/fusion/suggestions${suffix}`, {
    headers: authHeaders(token)
  });
}

export async function fetchIncidents(apiBase: string, token: string | undefined, options: IncidentListOptions = {}): Promise<IncidentListResponse> {
  const query = new URLSearchParams();
  appendMapBoundsQuery(query, options.bbox);
  if (options.categories?.length) {
    query.set("category", options.categories.join(","));
  }
  if (options.statuses?.length) {
    query.set("status", options.statuses.join(","));
  }
  if (options.includeClosed !== undefined) {
    query.set("includeClosed", String(options.includeClosed));
  }
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchJson<IncidentListResponse>(`${apiBase}/api/v1/incidents${suffix}`, {
    headers: authHeaders(token)
  });
}

export async function createIncident(apiBase: string, token: string, payload: IncidentCreatePayload): Promise<IncidentRecord> {
  return fetchJson<IncidentRecord>(`${apiBase}/api/v1/incidents`, {
    body: JSON.stringify(payload),
    headers: {
      ...(authHeaders(token) ?? {}),
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function updateIncident(apiBase: string, token: string, incidentId: string, payload: IncidentUpdatePayload): Promise<IncidentRecord> {
  return fetchJson<IncidentRecord>(`${apiBase}/api/v1/incidents/${encodeURIComponent(incidentId)}`, {
    body: JSON.stringify(payload),
    headers: {
      ...(authHeaders(token) ?? {}),
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
}

export async function fetchIncidentTasks(
  apiBase: string,
  token: string | undefined,
  incidentId: string,
  options: IncidentTaskListOptions = {}
): Promise<IncidentTaskListResponse> {
  const query = new URLSearchParams();
  if (options.statuses?.length) {
    query.set("status", options.statuses.join(","));
  }
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchJson<IncidentTaskListResponse>(`${apiBase}/api/v1/incidents/${encodeURIComponent(incidentId)}/tasks${suffix}`, {
    headers: authHeaders(token)
  });
}

export async function createIncidentTask(
  apiBase: string,
  token: string,
  incidentId: string,
  payload: IncidentTaskCreatePayload
): Promise<IncidentTaskRecord> {
  return fetchJson<IncidentTaskRecord>(`${apiBase}/api/v1/incidents/${encodeURIComponent(incidentId)}/tasks`, {
    body: JSON.stringify(payload),
    headers: {
      ...(authHeaders(token) ?? {}),
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function updateIncidentTask(
  apiBase: string,
  token: string,
  incidentId: string,
  taskId: string,
  payload: IncidentTaskUpdatePayload
): Promise<IncidentTaskRecord> {
  return fetchJson<IncidentTaskRecord>(`${apiBase}/api/v1/incidents/${encodeURIComponent(incidentId)}/tasks/${encodeURIComponent(taskId)}`, {
    body: JSON.stringify(payload),
    headers: {
      ...(authHeaders(token) ?? {}),
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
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

export async function fetchSafetyHydroStationDetail(
  apiBase: string,
  token: string | undefined,
  detailUrl: string
): Promise<HydroStationDetailResponse> {
  const request = safetyHydroStationDetailRequest(detailUrl);
  if (!request.query.has("series")) {
    request.query.set("series", "H,Q,TH,H_F,Q_F");
  }
  const suffix = request.query.toString() ? `?${request.query.toString()}` : "";
  return fetchJson<HydroStationDetailResponse>(
    `${apiBase}/api/v1/safety/hydro/stations/${encodeURIComponent(request.stationId)}/observations${suffix}`,
    {
      headers: {
        ...(authHeaders(token) ?? {}),
        Accept: "application/json"
      }
    }
  );
}

export async function fetchWeatherStationDetail(
  apiBase: string,
  token: string | undefined,
  detailUrl: string,
  options: { forecastHours?: number; historyHours?: number } = {}
): Promise<WeatherStationDetailResponse> {
  const request = weatherStationDetailRequest(detailUrl);
  if (!request.query.has("historyHours")) {
    request.query.set("historyHours", String(options.historyHours ?? 48));
  }
  if (!request.query.has("forecastHours")) {
    request.query.set("forecastHours", String(options.forecastHours ?? 24));
  }
  const suffix = request.query.toString() ? `?${request.query.toString()}` : "";
  return fetchJson<WeatherStationDetailResponse>(
    `${apiBase}/api/v1/weather-stations/${encodeURIComponent(request.stationId)}/detail${suffix}`,
    {
      headers: {
        ...(authHeaders(token) ?? {}),
        Accept: "application/json"
      }
    }
  );
}

export async function fetchWeatherForecastAreaDetail(
  apiBase: string,
  token: string | undefined,
  detailUrl: string,
  options: { dailyDays?: number; forecastHours?: number; nowcastHours?: number } = {}
): Promise<WeatherForecastAreaDetailResponse> {
  const request = weatherForecastAreaDetailRequest(detailUrl);
  if (!request.query.has("nowcastHours") && options.nowcastHours !== undefined) {
    request.query.set("nowcastHours", String(options.nowcastHours));
  }
  if (!request.query.has("forecastHours") && options.forecastHours !== undefined) {
    request.query.set("forecastHours", String(options.forecastHours));
  }
  if (!request.query.has("dailyDays") && options.dailyDays !== undefined) {
    request.query.set("dailyDays", String(options.dailyDays));
  }
  const suffix = request.query.toString() ? `?${request.query.toString()}` : "";
  return fetchJson<WeatherForecastAreaDetailResponse>(
    `${apiBase}/api/v1/weather-forecast/areas/${encodeURIComponent(request.areaId)}/detail${suffix}`,
    {
      headers: {
        ...(authHeaders(token) ?? {}),
        Accept: "application/json"
      }
    }
  );
}

export async function fetchTransitVehicleDetail(
  apiBase: string,
  token: string | undefined,
  detailUrl: string | undefined,
  fallback: { featureId: string; sourceId?: string }
): Promise<TransitVehicleDetailResponse> {
  const request = transitVehicleDetailRequest(detailUrl, fallback);
  const suffix = request.query.toString() ? `?${request.query.toString()}` : "";
  return fetchJson<TransitVehicleDetailResponse>(
    `${apiBase}/api/v1/transit/vehicles/${encodeURIComponent(request.featureId)}/detail${suffix}`,
    {
      headers: {
        ...(authHeaders(token) ?? {}),
        Accept: "application/json"
      }
    }
  );
}

export async function fetchTransitStopDetail(
  apiBase: string,
  token: string | undefined,
  detailUrl: string | undefined,
  fallback: { sourceId?: string; stopId?: string; systemId?: string }
): Promise<TransitStopDetailResponse> {
  const request = transitStopDetailRequest(detailUrl, fallback);
  const suffix = request.query.toString() ? `?${request.query.toString()}` : "";
  return fetchJson<TransitStopDetailResponse>(
    `${apiBase}/api/v1/transit/stops/${encodeURIComponent(request.systemId)}/${encodeURIComponent(request.stopId)}/detail${suffix}`,
    {
      headers: {
        ...(authHeaders(token) ?? {}),
        Accept: "application/json"
      }
    }
  );
}

export async function fetchMobileTowerViewshed(
  apiBase: string,
  token: string | undefined,
  towerId: string,
  options: {
    azimuthStepDeg?: number;
    distanceStepM?: number;
    radiusM?: number;
    technology?: MobileCoverageTechnology;
  } = {}
): Promise<MobileTowerViewshedResponse> {
  const query = new URLSearchParams();
  query.set("technology", options.technology ?? "4G");
  query.set("radiusM", String(options.radiusM ?? 12_000));
  query.set("azimuthStepDeg", String(options.azimuthStepDeg ?? 10));
  query.set("distanceStepM", String(options.distanceStepM ?? 500));
  return fetchJson<MobileTowerViewshedResponse>(
    `${apiBase}/api/v1/mobile-coverage/towers/${encodeURIComponent(towerId)}/viewshed?${query.toString()}`,
    {
      headers: {
        ...(authHeaders(token) ?? {}),
        Accept: "application/json"
      }
    }
  );
}

export async function fetchRadioProfiles(apiBase: string, token: string | undefined): Promise<RadioProfilesResponse> {
  return fetchJson<RadioProfilesResponse>(`${apiBase}/api/v1/radio/profiles`, {
    headers: {
      ...(authHeaders(token) ?? {}),
      Accept: "application/json"
    }
  });
}

export async function createRadioProfile(apiBase: string, token: string | undefined, profile: RadioProfile): Promise<RadioProfilesResponse> {
  return fetchJson<RadioProfilesResponse>(`${apiBase}/api/v1/radio/profiles`, {
    body: JSON.stringify(profile),
    headers: {
      ...(authHeaders(token) ?? {}),
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function runRadioCoverage(
  apiBase: string,
  token: string | undefined,
  request: RadioCoverageRequest
): Promise<RadioFeatureCollectionResponse> {
  return fetchJson<RadioFeatureCollectionResponse>(`${apiBase}/api/v1/radio/coverage`, {
    body: JSON.stringify(request),
    headers: {
      ...(authHeaders(token) ?? {}),
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function runRadioLinkCheck(
  apiBase: string,
  token: string | undefined,
  request: RadioLinkCheckRequest
): Promise<RadioLinkCheckResponse> {
  return fetchJson<RadioLinkCheckResponse>(`${apiBase}/api/v1/radio/link-check`, {
    body: JSON.stringify(request),
    headers: {
      ...(authHeaders(token) ?? {}),
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function runRadioSiteSearch(
  apiBase: string,
  token: string | undefined,
  request: RadioSiteSearchRequest
): Promise<RadioFeatureCollectionResponse> {
  return fetchJson<RadioFeatureCollectionResponse>(`${apiBase}/api/v1/radio/site-search`, {
    body: JSON.stringify(request),
    headers: {
      ...(authHeaders(token) ?? {}),
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

function safetyHydroStationDetailRequest(detailUrl: string): { query: URLSearchParams; stationId: string } {
  const url = new URL(detailUrl, "https://cop.local");
  const match = /^(?:\/safety-data)?\/api\/v1\/hydro\/stations\/([^/]+)\/observations$/u.exec(url.pathname)
    ?? /^\/api\/v1\/safety\/hydro\/stations\/([^/]+)\/observations$/u.exec(url.pathname);
  const stationId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  if (!stationId) {
    throw new Error("Neplatná adresa detailu hydrologické stanice.");
  }
  return {
    query: new URLSearchParams(url.searchParams),
    stationId
  };
}

function weatherStationDetailRequest(detailUrl: string): { query: URLSearchParams; stationId: string } {
  const url = new URL(detailUrl, "https://cop.local");
  const match = /^(?:\/situation-data)?\/api\/v1\/weather-stations\/([^/]+)\/detail$/u.exec(url.pathname)
    ?? /^\/api\/v1\/weather-stations\/([^/]+)\/detail$/u.exec(url.pathname);
  const stationId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  if (!stationId) {
    throw new Error("Neplatná adresa detailu meteorologické stanice.");
  }
  return {
    query: new URLSearchParams(url.searchParams),
    stationId
  };
}

function weatherForecastAreaDetailRequest(detailUrl: string): { areaId: string; query: URLSearchParams } {
  const url = new URL(detailUrl, "https://cop.local");
  const match = /^(?:\/situation-data)?\/api\/v1\/weather-forecast\/areas\/([^/]+)$/u.exec(url.pathname)
    ?? /^(?:\/situation-data)?\/api\/v1\/weather-forecast\/areas\/([^/]+)\/detail$/u.exec(url.pathname)
    ?? /^(?:\/situation-data)?\/api\/v1\/weather-forecast\/areas\/([^/]+)\/meteogram$/u.exec(url.pathname)
    ?? /^(?:\/situation-data)?\/api\/v1\/weather-forecast\/areas\/([^/]+)\/charts$/u.exec(url.pathname)
    ?? /^\/api\/v1\/weather-forecast\/areas\/([^/]+)\/detail$/u.exec(url.pathname)
    ?? /^\/api\/v1\/weather-forecast\/areas\/([^/]+)\/meteogram$/u.exec(url.pathname)
    ?? /^\/api\/v1\/weather-forecast\/areas\/([^/]+)\/charts$/u.exec(url.pathname);
  const areaId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  if (!areaId) {
    throw new Error("Neplatná adresa detailu plošné předpovědi počasí.");
  }
  return {
    areaId,
    query: new URLSearchParams(url.searchParams)
  };
}

function transitVehicleDetailRequest(detailUrl: string | undefined, fallback: { featureId: string; sourceId?: string }): { featureId: string; query: URLSearchParams } {
  const query = new URLSearchParams();
  if (!detailUrl) {
    if (fallback.sourceId) {
      query.set("source", fallback.sourceId);
    }
    return { featureId: fallback.featureId, query };
  }
  const url = new URL(detailUrl, "https://cop.local");
  const match = /^(?:\/situation-data)?\/api\/v1\/transit\/vehicles\/([^/]+)$/u.exec(url.pathname)
    ?? /^\/api\/v1\/transit\/vehicles\/([^/]+)\/detail$/u.exec(url.pathname);
  const featureId = match?.[1] ? decodeURIComponent(match[1]) : fallback.featureId;
  if (!featureId) {
    throw new Error("Neplatná adresa detailu vozidla veřejné dopravy.");
  }
  url.searchParams.forEach((value, key) => query.set(key, value));
  if (!query.has("source") && fallback.sourceId) {
    query.set("source", fallback.sourceId);
  }
  return { featureId, query };
}

function transitStopDetailRequest(detailUrl: string | undefined, fallback: { sourceId?: string; stopId?: string; systemId?: string }): { query: URLSearchParams; stopId: string; systemId: string } {
  const query = new URLSearchParams();
  if (!detailUrl) {
    if (fallback.sourceId) {
      query.set("source", fallback.sourceId);
    }
    if (!fallback.systemId || !fallback.stopId) {
      throw new Error("Detail zastávky vyžaduje systemId a stopId.");
    }
    return { query, stopId: fallback.stopId, systemId: fallback.systemId };
  }
  const url = new URL(detailUrl, "https://cop.local");
  const match = /^(?:\/situation-data)?\/api\/v1\/transit\/stops\/([^/]+)\/([^/]+)$/u.exec(url.pathname)
    ?? /^\/api\/v1\/transit\/stops\/([^/]+)\/([^/]+)\/detail$/u.exec(url.pathname);
  const systemId = match?.[1] ? decodeURIComponent(match[1]) : fallback.systemId;
  const stopId = match?.[2] ? decodeURIComponent(match[2]) : fallback.stopId;
  if (!systemId || !stopId) {
    throw new Error("Neplatná adresa detailu zastávky veřejné dopravy.");
  }
  url.searchParams.forEach((value, key) => query.set(key, value));
  if (!query.has("source") && fallback.sourceId) {
    query.set("source", fallback.sourceId);
  }
  return { query, stopId, systemId };
}

export async function fetchWeatherRadarFrames(
  apiBase: string,
  token: string | undefined,
  options: { hours?: number; limit?: number; product?: string } = {}
): Promise<WeatherRadarFramesResponse> {
  const query = new URLSearchParams();
  query.set("product", options.product ?? "merge1h");
  query.set("hours", String(options.hours ?? 6));
  query.set("limit", String(options.limit ?? 24));
  return fetchJson<WeatherRadarFramesResponse>(`${apiBase}/api/v1/weather-radar/frames?${query.toString()}`, {
    headers: authHeaders(token)
  });
}

export async function fetchSketchDrawings(
  apiBase: string,
  token: string | undefined,
  options: {
    bbox?: MapBounds;
    eventId?: string;
    groupId?: string;
    limit?: number;
  } = {}
): Promise<SketchDrawingFeatureCollection> {
  const query = new URLSearchParams();
  if (options.bbox) {
    query.set("bbox", [options.bbox.west, options.bbox.south, options.bbox.east, options.bbox.north].join(","));
  }
  if (options.eventId) {
    query.set("eventId", options.eventId);
  }
  if (options.groupId) {
    query.set("groupId", options.groupId);
  }
  if (options.limit) {
    query.set("limit", String(options.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchJson<SketchDrawingFeatureCollection>(`${apiBase}/api/v1/sketch/drawings${suffix}`, {
    headers: authHeaders(token)
  });
}

export async function createSketchDrawing(
  apiBase: string,
  token: string,
  payload: SketchDrawingPayload & { geometry: SketchGeometry; kind: SketchDrawingKind; visibility: SketchDrawingVisibility }
): Promise<SketchDrawingFeature> {
  return fetchJson<SketchDrawingFeature>(`${apiBase}/api/v1/sketch/drawings`, {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function updateSketchDrawing(
  apiBase: string,
  token: string,
  drawingId: string,
  payload: SketchDrawingPayload
): Promise<SketchDrawingFeature> {
  return fetchJson<SketchDrawingFeature>(`${apiBase}/api/v1/sketch/drawings/${encodeURIComponent(drawingId)}`, {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
}

export async function deleteSketchDrawing(apiBase: string, token: string, drawingId: string): Promise<void> {
  const response = await fetch(`${apiBase}/api/v1/sketch/drawings/${encodeURIComponent(drawingId)}`, {
    headers: authHeaders(token),
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || "API request failed"} for ${apiBase}/api/v1/sketch/drawings/${encodeURIComponent(drawingId)}`);
  }
}

export async function fetchSketchPalettes(
  apiBase: string,
  token: string | undefined,
  mode?: SketchPaletteMode
): Promise<SketchPaletteResponse> {
  const suffix = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  return fetchJson<SketchPaletteResponse>(`${apiBase}/api/v1/sketch/palettes${suffix}`, {
    headers: authHeaders(token)
  });
}

export async function fetchPlaceGeocode(
  apiBase: string,
  token: string | undefined,
  query: string,
  options: { language?: string; limit?: number } = {}
): Promise<PlaceGeocodeResponse> {
  const params = new URLSearchParams({
    q: query,
    limit: String(options.limit ?? 5)
  });
  if (options.language) {
    params.set("language", options.language);
  }
  return fetchJson<PlaceGeocodeResponse>(`${apiBase}/api/v1/geocode/search?${params.toString()}`, {
    headers: authHeaders(token)
  });
}

export async function fetchUserProfile(apiBase: string, token: string): Promise<ServerUserProfile> {
  return fetchJson<ServerUserProfile>(`${apiBase}/api/v1/me/preferences`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export async function searchUserDirectory(apiBase: string, token: string, query: string, limit = 8): Promise<UserDirectorySearchResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    q: query
  });
  return fetchJson<UserDirectorySearchResponse>(`${apiBase}/api/v1/users/search?${params.toString()}`, {
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

export async function createMobilePairingSession(apiBase: string, token: string, ttlSeconds = 600): Promise<MobilePairingSessionResponse> {
  return fetchJson<MobilePairingSessionResponse>(`${apiBase}/api/v1/mobile/pairing/sessions`, {
    body: JSON.stringify({ ttlSeconds }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function fetchMobilePairingSession(apiBase: string, token: string, code: string): Promise<MobilePairingSessionResponse> {
  return fetchJson<MobilePairingSessionResponse>(`${apiBase}/api/v1/mobile/pairing/sessions/${encodeURIComponent(code)}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export async function confirmMobilePairingSession(apiBase: string, token: string, code: string): Promise<MobilePairingSessionResponse> {
  return fetchJson<MobilePairingSessionResponse>(`${apiBase}/api/v1/mobile/pairing/sessions/${encodeURIComponent(code)}/confirm`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    method: "POST"
  });
}

export async function fetchMobileDevices(apiBase: string, token: string): Promise<MobileDevicesResponse> {
  return fetchJson<MobileDevicesResponse>(`${apiBase}/api/v1/mobile/devices`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export async function revokeMobileDevice(apiBase: string, token: string, deviceId: string): Promise<MobileDevicesResponse> {
  return fetchJson<MobileDevicesResponse>(`${apiBase}/api/v1/mobile/devices/${encodeURIComponent(deviceId)}`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    method: "DELETE"
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

export async function createAiSituationSummary(apiBase: string, token: string, options: AiSituationSummaryOptions = {}): Promise<AiCopResponse> {
  return fetchJson<AiCopResponse>(`${apiBase}/api/v1/ai/situation-summary`, {
    body: JSON.stringify(options),
    headers: {
      ...(authHeaders(token) ?? {}),
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function queryAiChatAgent(apiBase: string, token: string, options: AiChatAgentQueryOptions): Promise<AiCopResponse> {
  return fetchJson<AiCopResponse>(`${apiBase}/api/v1/ai/chat-agent/query`, {
    body: JSON.stringify(options),
    headers: {
      ...(authHeaders(token) ?? {}),
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

export async function fetchMessagingBootstrap(apiBase: string, token: string, deviceId: string): Promise<MessagingBootstrapResponse> {
  return fetchJson<MessagingBootstrapResponse>(`${apiBase}/api/v1/messaging/bootstrap`, {
    body: JSON.stringify({ deviceId }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function fetchMessagingConversations(apiBase: string, token: string): Promise<MessagingConversationListResponse> {
  return fetchJson<MessagingConversationListResponse>(`${apiBase}/api/v1/messaging/conversations`, {
    headers: authHeaders(token)
  });
}

export async function fetchDemoScenarios(apiBase: string, token: string): Promise<DemoScenarioListResponse> {
  return fetchJson<DemoScenarioListResponse>(`${apiBase}/api/v1/demo/scenarios`, {
    headers: authHeaders(token)
  });
}

export async function fetchDemoScenarioStatus(apiBase: string, token: string, scenarioId: string): Promise<DemoScenarioResponse> {
  return fetchJson<DemoScenarioResponse>(`${apiBase}/api/v1/demo/scenarios/${encodeURIComponent(scenarioId)}/status`, {
    headers: authHeaders(token)
  });
}

export async function seedDemoScenario(apiBase: string, token: string, scenarioId: string): Promise<DemoScenarioResponse> {
  return fetchJson<DemoScenarioResponse>(`${apiBase}/api/v1/demo/scenarios/${encodeURIComponent(scenarioId)}/seed`, {
    headers: authHeaders(token),
    method: "POST"
  });
}

export async function resetDemoScenario(apiBase: string, token: string, scenarioId: string): Promise<DemoScenarioResponse> {
  return fetchJson<DemoScenarioResponse>(`${apiBase}/api/v1/demo/scenarios/${encodeURIComponent(scenarioId)}/reset`, {
    headers: authHeaders(token),
    method: "POST"
  });
}

export async function createMessagingConversation(
  apiBase: string,
  token: string,
  payload: {
    members?: Array<{ displayName?: string; role?: string; userId: string }>;
    metadata?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
    title: string;
    type?: "direct" | "group";
  }
): Promise<MessagingConversationCreateResponse> {
  return fetchJson<MessagingConversationCreateResponse>(`${apiBase}/api/v1/messaging/conversations`, {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function resolveMessagingMatrixIdentities(
  apiBase: string,
  token: string,
  userIds: string[]
): Promise<MessagingMatrixIdentityResolutionResponse> {
  return fetchJson<MessagingMatrixIdentityResolutionResponse>(`${apiBase}/api/v1/messaging/matrix/identities/resolve`, {
    body: JSON.stringify({ userIds }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function bindMessagingConversationMatrixRoom(
  apiBase: string,
  token: string,
  conversationId: string,
  payload: { encrypted?: boolean; roomId: string }
): Promise<MessagingMatrixRoomBindingResponse> {
  return fetchJson<MessagingMatrixRoomBindingResponse>(
    `${apiBase}/api/v1/messaging/conversations/${encodeURIComponent(conversationId)}/matrix-room`,
    {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    }
  );
}

export async function syncMessagingConversationMembers(
  apiBase: string,
  token: string,
  conversationId: string,
  members: Array<{ displayName?: string; role?: string; userId: string }>
): Promise<MessagingConversationMemberSyncResponse> {
  return fetchJson<MessagingConversationMemberSyncResponse>(
    `${apiBase}/api/v1/messaging/conversations/${encodeURIComponent(conversationId)}/members`,
    {
      body: JSON.stringify({ members }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    }
  );
}

export async function createCommunityReport(
  apiBase: string,
  token: string,
  payload: {
    category: CommunityReportCategory;
    description?: string;
    hazardSeverity: CommunityReportHazardSeverity;
    groupId?: string;
    groupName?: string;
    location: CommunityReportLocation;
    observedAt?: string;
    title: string;
    validUntil?: string;
    visibility?: CommunityReportVisibility;
  }
): Promise<CommunityReport> {
  return fetchJson<CommunityReport>(`${apiBase}/api/v1/community/reports`, {
    body: JSON.stringify({
      ...payload,
      ...(payload.groupId ? { groupId: payload.groupId } : {}),
      ...(payload.groupName ? { groupName: payload.groupName } : {}),
      properties: {
        ...(payload.groupId ? { groupId: payload.groupId } : {}),
        ...(payload.groupName ? { groupName: payload.groupName } : {}),
        hazardSeverity: payload.hazardSeverity,
        ...(payload.validUntil ? { validUntil: payload.validUntil } : {})
      },
      visibility: payload.visibility ?? "community"
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function fetchCommunityGroups(apiBase: string, token: string): Promise<{ items: CommunityGroup[]; serverTimestamp: string }> {
  return fetchJson<{ items: CommunityGroup[]; serverTimestamp: string }>(`${apiBase}/api/v1/community/groups`, {
    headers: authHeaders(token)
  });
}

export async function createCommunityGroup(
  apiBase: string,
  token: string,
  payload: {
    anchorLocation?: CommunityReportLocation;
    description?: string;
    metadata?: Record<string, unknown>;
    name: string;
    visibility: CommunityGroupVisibility;
  }
): Promise<CommunityGroup> {
  return fetchJson<CommunityGroup>(`${apiBase}/api/v1/community/groups`, {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function deleteCommunityGroup(apiBase: string, token: string, groupId: string): Promise<void> {
  const response = await fetch(`${apiBase}/api/v1/community/groups/${encodeURIComponent(groupId)}`, {
    headers: authHeaders(token),
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || "API request failed"} for ${apiBase}/api/v1/community/groups/${encodeURIComponent(groupId)}`);
  }
}

export async function updateCommunityGroupMetadata(
  apiBase: string,
  token: string,
  groupId: string,
  metadata: Record<string, unknown>
): Promise<CommunityGroup> {
  return fetchJson<CommunityGroup>(`${apiBase}/api/v1/community/groups/${encodeURIComponent(groupId)}/metadata`, {
    body: JSON.stringify({ metadata }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
}

export async function updateCommunityReport(
  apiBase: string,
  token: string,
  reportId: string,
  payload: {
    category?: CommunityReportCategory;
    description?: string;
    hazardSeverity?: CommunityReportHazardSeverity;
    groupId?: string;
    groupName?: string;
    location?: CommunityReportLocation;
    title?: string;
    validUntil?: string;
    visibility?: CommunityReportVisibility;
  }
): Promise<CommunityReport> {
  return fetchJson<CommunityReport>(`${apiBase}/api/v1/community/reports/${encodeURIComponent(reportId)}`, {
    body: JSON.stringify({
      ...payload,
      properties: {
        ...(payload.groupId ? { groupId: payload.groupId } : {}),
        ...(payload.groupName ? { groupName: payload.groupName } : {}),
        ...(payload.hazardSeverity ? { hazardSeverity: payload.hazardSeverity } : {}),
        ...(payload.validUntil ? { validUntil: payload.validUntil } : {})
      }
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
}

export async function deleteCommunityReport(apiBase: string, token: string, reportId: string): Promise<void> {
  const response = await fetch(`${apiBase}/api/v1/community/reports/${encodeURIComponent(reportId)}`, {
    headers: authHeaders(token),
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || "API request failed"} for ${apiBase}/api/v1/community/reports/${encodeURIComponent(reportId)}`);
  }
}

export async function requestCommunityGroupJoin(apiBase: string, token: string, groupId: string): Promise<CommunityGroup> {
  return fetchJson<CommunityGroup>(`${apiBase}/api/v1/community/groups/${encodeURIComponent(groupId)}/join-request`, {
    headers: authHeaders(token),
    method: "POST"
  });
}

export async function leaveCommunityGroup(apiBase: string, token: string, groupId: string): Promise<CommunityGroup> {
  return fetchJson<CommunityGroup>(`${apiBase}/api/v1/community/groups/${encodeURIComponent(groupId)}/members/me`, {
    headers: authHeaders(token),
    method: "DELETE"
  });
}

export async function removeCommunityGroupMember(apiBase: string, token: string, groupId: string, subjectId: string): Promise<CommunityGroup> {
  return fetchJson<CommunityGroup>(
    `${apiBase}/api/v1/community/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(subjectId)}`,
    {
      headers: authHeaders(token),
      method: "DELETE"
    }
  );
}

export async function upsertCommunityGroupMember(
  apiBase: string,
  token: string,
  groupId: string,
  payload: {
    displayName?: string;
    role?: CommunityGroupMemberRole;
    status?: CommunityGroupMemberStatus;
    subjectId: string;
    username?: string;
  }
): Promise<CommunityGroup> {
  return fetchJson<CommunityGroup>(`${apiBase}/api/v1/community/groups/${encodeURIComponent(groupId)}/members`, {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function createCommunityAttachmentUpload(
  apiBase: string,
  token: string,
  reportId: string,
  payload: {
    byteSize: number;
    captureLocation?: CommunityReportLocation;
    contentType: string;
    fileName?: string;
    kind: CommunityAttachmentKind;
    metadata?: Record<string, unknown>;
  }
): Promise<{ attachment: CommunityReportAttachment; upload: CommunityAttachmentUploadSlot }> {
  return fetchJson<{ attachment: CommunityReportAttachment; upload: CommunityAttachmentUploadSlot }>(
    `${apiBase}/api/v1/community/reports/${encodeURIComponent(reportId)}/attachments`,
    {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    }
  );
}

export async function completeCommunityAttachmentUpload(
  apiBase: string,
  token: string,
  reportId: string,
  attachmentId: string,
  payload: { byteSize: number; checksumSha256?: string }
): Promise<CommunityReportAttachment> {
  return fetchJson<CommunityReportAttachment>(
    `${apiBase}/api/v1/community/reports/${encodeURIComponent(reportId)}/attachments/${encodeURIComponent(attachmentId)}/complete`,
    {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    }
  );
}

export async function uploadCommunityAttachmentViaApi(
  apiBase: string,
  token: string,
  reportId: string,
  attachmentId: string,
  file: File,
  onProgress?: CommunityAttachmentUploadProgressHandler
): Promise<CommunityReportAttachment> {
  const uploadUrl = `${apiBase}/api/v1/community/reports/${encodeURIComponent(reportId)}/attachments/${encodeURIComponent(attachmentId)}/upload`;
  const response = await uploadFileWithProgress(uploadUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-COP-Upload-Mode": "binary"
    },
    file,
    method: "POST",
    onProgress: onProgress ? (progress) => onProgress({ ...progress, phase: "proxy" }) : undefined
  });
  if (!response.ok) {
    const statusText = response.statusText || "API request failed";
    const sizeHint = response.status === 413
      ? ` Soubor má ${formatBytes(file.size)}; zvyšte COP_MEDIA_MAX_ATTACHMENT_BYTES a nginx client_max_body_size.`
      : "";
    throw new Error(`${response.status} ${statusText} for ${uploadUrl}.${sizeHint}`);
  }
  return (await response.json()) as CommunityReportAttachment;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function tryDirectCommunityAttachmentUpload(
  apiBase: string,
  token: string,
  reportId: string,
  file: File,
  slot: { attachment: CommunityReportAttachment; upload: CommunityAttachmentUploadSlot },
  onProgress?: CommunityAttachmentUploadProgressHandler
): Promise<CommunityReportAttachment | null> {
  try {
    const directResponse = await uploadFileWithProgress(slot.upload.uploadUrl, {
      headers: slot.upload.headers,
      file,
      method: "PUT",
      onProgress: onProgress ? (progress) => onProgress({ ...progress, phase: "direct" }) : undefined
    });
    if (!directResponse.ok) {
      return null;
    }
    return completeCommunityAttachmentUpload(apiBase, token, reportId, slot.attachment.attachmentId, {
      byteSize: file.size
    });
  } catch {
    return null;
  }
}

export async function uploadCommunityAttachmentFile(
  apiBase: string,
  token: string,
  reportId: string,
  file: File,
  slot: { attachment: CommunityReportAttachment; upload: CommunityAttachmentUploadSlot },
  onProgress?: CommunityAttachmentUploadProgressHandler
): Promise<CommunityReportAttachment> {
  const directUpload = await tryDirectCommunityAttachmentUpload(apiBase, token, reportId, file, slot, onProgress);
  if (directUpload) {
    return directUpload;
  }
  return uploadCommunityAttachmentViaApi(apiBase, token, reportId, slot.attachment.attachmentId, file, onProgress);
}

function uploadFileWithProgress(
  url: string,
  input: {
    file: File;
    headers: Record<string, string>;
    method: "POST" | "PUT";
    onProgress?: CommunityAttachmentUploadProgressHandler;
  }
): Promise<{ ok: boolean; json: () => Promise<unknown>; status: number; statusText: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(input.method, url);
    for (const [name, value] of Object.entries(input.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      input.onProgress?.({
        lengthComputable: event.lengthComputable,
        loaded: event.loaded,
        phase: input.method === "PUT" ? "direct" : "proxy",
        total: event.lengthComputable ? event.total : input.file.size
      });
    };
    request.onload = () => {
      input.onProgress?.({
        lengthComputable: true,
        loaded: input.file.size,
        phase: input.method === "PUT" ? "direct" : "proxy",
        total: input.file.size
      });
      resolve({
        json: async () => JSON.parse(request.responseText || "null"),
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
        statusText: request.statusText
      });
    };
    request.onerror = () => reject(new Error("Attachment upload failed before the server responded."));
    request.onabort = () => reject(new Error("Attachment upload was cancelled."));
    request.send(input.file);
  });
}

export async function submitCommunityReport(apiBase: string, token: string, reportId: string): Promise<CommunityReport> {
  return fetchJson<CommunityReport>(`${apiBase}/api/v1/community/reports/${encodeURIComponent(reportId)}/submit`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    method: "POST"
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
    const apiMessage = await readApiErrorMessage(response);
    throw new Error(apiMessage ?? `${response.status} ${response.statusText || "API request failed"} for ${url}`);
  }
  return (await response.json()) as T;
}

async function readApiErrorMessage(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return undefined;
  }
  try {
    const body = (await response.clone().json()) as unknown;
    if (typeof body === "object" && body !== null && "error" in body) {
      const error = (body as { error?: unknown }).error;
      if (typeof error === "object" && error !== null && "message" in error) {
        const message = (error as { message?: unknown }).message;
        return typeof message === "string" && message.trim().length > 0 ? message : undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
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

function appendMapBoundsQuery(query: URLSearchParams, bbox: MapBounds | undefined): void {
  if (!bbox) {
    return;
  }
  query.set("bbox", [bbox.west, bbox.south, bbox.east, bbox.north].join(","));
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
