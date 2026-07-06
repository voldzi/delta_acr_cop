import { createPublicSituationAggregateSourceSystem, type SourceSystem } from "@cop/canonical-model";
import {
  normalizeProviderMapCatalog,
  normalizeProviderTaxonomy,
  providerTaxonomyEntryCount,
  type ProviderMapCatalog,
  type ProviderTaxonomy
} from "./provider-map-catalog.js";
import type { SourceHealthOverride } from "./types.js";

export type SituationLayerId =
  | "air_quality"
  | "air_quality_grid"
  | "boundary_admin"
  | "boundary_country"
  | "boundary_district"
  | "boundary_municipality"
  | "boundary_orp"
  | "boundary_region"
  | "community_places"
  | "fire"
  | "flood"
  | "ground"
  | "mobile"
  | "mobile_coverage"
  | "mobile_network"
  | "outdoor_webcams"
  | "place_settlements"
  | "trail_poi"
  | "trail_routes"
  | "traffic"
  | "warnings"
  | "weather"
  | "weather_alerts"
  | "weather_forecast_area"
  | "weather_webcams"
  | "weather_humidity_grid"
  | "weather_precipitation_grid"
  | "weather_pressure_grid"
  | "weather_radar_nowcast"
  | "weather_radar_precipitation"
  | "weather_radar_reflectivity"
  | "weather_temperature_grid"
  | "weather_thunderstorm_risk"
  | "weather_wind_field";

type SituationCacheStatus = "coalesced" | "hit" | "miss" | "stale";

const MOBILE_TOWER_VIEWSHED_TIMEOUT_MS = 20_000;

export interface SituationDataCacheStats {
  entries: number;
  inflight: number;
  hits: number;
  misses: number;
  coalescedHits: number;
  staleHits: number;
  refreshes: number;
  errors: number;
  evictions: number;
}

export interface SituationDataSourceConfig {
  baseUrl: string;
  cacheMaxEntries?: number;
  cacheTtlMs: number;
  enabled: boolean;
  layerCacheTtlMs?: Partial<Record<SituationLayerId, number>>;
  maxLimit: number;
  sourceCacheTtlMs?: Record<string, number>;
  staleIfErrorMs?: number;
  timeoutMs: number;
}

export interface SituationFeatureQuery {
  bbox: SituationBbox;
  layers: SituationLayerId[];
  limit: number;
  sources?: string[];
  technology?: string;
}

export interface SituationBbox {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface SituationLayerDescriptor {
  defaultVisible: boolean;
  description?: string;
  expectedCadenceSeconds?: number;
  geometryTypes?: string[];
  label: string;
  layerId: SituationLayerId;
}

export interface SituationFeatureCollection {
  contractVersion: "cop-situation-source-v1";
  features: SituationFeature[];
  generatedAt: string;
  query: {
    bbox: SituationBbox;
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
    status: SituationCacheStatus;
    ttlMs: number;
    upstreamBbox: SituationBbox;
  };
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

export type MobileCoverageTechnology = "2G" | "4G" | "5G";

export interface MobileTowerViewshedQuery {
  azimuthStepDeg: number;
  distanceStepM: number;
  radiusM: number;
  technology: MobileCoverageTechnology;
}

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

export interface RadioProfileRequestBase {
  profile?: RadioProfile;
  profileId?: string;
  radioName?: string;
}

export interface RadioCoverageRequest extends RadioProfileRequestBase {
  azimuthStepDeg?: number;
  distanceStepM?: number;
  radiusM?: number;
  station: RadioPoint;
}

export interface RadioLinkCheckRequest extends RadioProfileRequestBase {
  from: RadioPoint;
  to: RadioPoint;
}

export interface RadioSiteSearchRequest extends RadioProfileRequestBase {
  gridStepM?: number;
  maxCandidates?: number;
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
  | { coordinates: Array<Array<[number, number]>>; type: "MultiLineString" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface SituationFeatureProperties {
  category: string;
  confidence?: number;
  assumptions?: Record<string, unknown>;
  btsStatus?: string;
  btsStatusSource?: string;
  dataQuality?: string;
  demSource?: string;
  disclaimer?: string;
  estimatedSignalDbm?: number;
  featureId: string;
  generatedAt?: string;
  iconHint?: string;
  label: string;
  layer: SituationLayerId;
  layerId?: string;
  license?: Record<string, unknown>;
  localized?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  modelVersion?: string;
  observedAt?: string;
  operator?: string;
  operatorStatusAvailable?: boolean;
  quality?: string;
  basis?: string[];
  notices?: string[];
  providerId?: string;
  providerLayerId?: string;
  providerProperties?: Record<string, unknown>;
  readModel?: boolean;
  rendering?: Record<string, unknown>;
  resolutionM?: number;
  severity?: "advisory" | "critical" | "info" | "warning" | string;
  sourceCode?: string;
  sourceId: string;
  sourceSystem?: string;
  sourceName?: string;
  stale?: boolean;
  status?: string;
  styleHint?: string;
  summary?: string;
  sourceRevision?: string;
  tags?: Record<string, unknown>;
  technology?: string;
  typeCode?: string;
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

export interface SituationDataSource {
  readonly config: SituationDataSourceConfig;
  readonly sourceSystem: SourceSystem;
  cacheStats?(): SituationDataCacheStats;
  fetchCatalog?(requestNow: Date): Promise<ProviderMapCatalog>;
  fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection>;
  fetchLayers(requestNow: Date): Promise<SituationLayerDescriptor[]>;
  fetchMobileTowerViewshed?(
    towerId: string,
    query: MobileTowerViewshedQuery,
    requestNow: Date
  ): Promise<MobileTowerViewshedResponse>;
  createRadioProfile?(profile: RadioProfile, requestNow: Date): Promise<RadioProfilesResponse>;
  fetchRadioProfiles?(requestNow: Date): Promise<RadioProfilesResponse>;
  runRadioCoverage?(request: RadioCoverageRequest, requestNow: Date): Promise<RadioFeatureCollectionResponse>;
  runRadioLinkCheck?(request: RadioLinkCheckRequest, requestNow: Date): Promise<RadioLinkCheckResponse>;
  runRadioSiteSearch?(request: RadioSiteSearchRequest, requestNow: Date): Promise<RadioFeatureCollectionResponse>;
  fetchSources(requestNow: Date): Promise<SituationSourceDescriptor[]>;
  fetchTaxonomy?(requestNow: Date): Promise<ProviderTaxonomy>;
}

const defaultConfig: SituationDataSourceConfig = {
  baseUrl: "http://docker.home.cz:5020/situation-data/api/v1",
  cacheMaxEntries: 5000,
  cacheTtlMs: 20000,
  enabled: false,
  layerCacheTtlMs: {
    air_quality: 15 * 60 * 1000,
    air_quality_grid: 15 * 60 * 1000,
    boundary_admin: 6 * 60 * 60 * 1000,
    boundary_country: 6 * 60 * 60 * 1000,
    boundary_district: 6 * 60 * 60 * 1000,
    boundary_municipality: 6 * 60 * 60 * 1000,
    boundary_orp: 6 * 60 * 60 * 1000,
    boundary_region: 6 * 60 * 60 * 1000,
    community_places: 6 * 60 * 60 * 1000,
    fire: 10 * 60 * 1000,
    flood: 5 * 60 * 1000,
    ground: 6 * 60 * 60 * 1000,
    mobile: 15 * 60 * 1000,
    mobile_coverage: 10 * 60 * 1000,
    mobile_network: 10 * 60 * 1000,
    outdoor_webcams: 6 * 60 * 60 * 1000,
    trail_poi: 6 * 60 * 60 * 1000,
    trail_routes: 6 * 60 * 60 * 1000,
    traffic: 20 * 1000,
    warnings: 5 * 60 * 1000,
    weather: 5 * 60 * 1000,
    weather_alerts: 5 * 60 * 1000,
    weather_forecast_area: 10 * 60 * 1000,
    weather_webcams: 10 * 60 * 1000,
    weather_humidity_grid: 10 * 60 * 1000,
    weather_precipitation_grid: 10 * 60 * 1000,
    weather_pressure_grid: 10 * 60 * 1000,
    weather_radar_nowcast: 5 * 60 * 1000,
    weather_radar_precipitation: 5 * 60 * 1000,
    weather_radar_reflectivity: 5 * 60 * 1000,
    weather_temperature_grid: 10 * 60 * 1000,
    weather_thunderstorm_risk: 5 * 60 * 1000,
    weather_wind_field: 10 * 60 * 1000
  },
  maxLimit: 250,
  sourceCacheTtlMs: {
    ardos_partner: 10 * 1000,
    aviation_weather: 120 * 1000,
    chmi_air_quality: 15 * 60 * 1000,
    chmi_weather_radar: 5 * 60 * 1000,
    chmi_weather_stations: 10 * 60 * 1000,
    chmi_weather_webcams: 10 * 60 * 1000,
    community_context: 6 * 60 * 60 * 1000,
    weather_forecast: 10 * 60 * 1000,
    mobile_coverage_model: 10 * 60 * 1000,
    mobile_network_model: 10 * 60 * 1000,
    osm_postgis: 6 * 60 * 60 * 1000
  },
  staleIfErrorMs: 10 * 60 * 1000,
  timeoutMs: 7000
};

const allowedLayerIds: SituationLayerId[] = [
  "weather",
  "weather_forecast_area",
  "weather_webcams",
  "weather_temperature_grid",
  "weather_wind_field",
  "weather_precipitation_grid",
  "weather_humidity_grid",
  "weather_pressure_grid",
  "weather_radar_reflectivity",
  "weather_radar_precipitation",
  "weather_radar_nowcast",
  "weather_thunderstorm_risk",
  "air_quality",
  "air_quality_grid",
  "ground",
  "mobile",
  "mobile_network",
  "mobile_coverage",
  "outdoor_webcams",
  "trail_routes",
  "trail_poi",
  "traffic",
  "warnings",
  "flood",
  "fire",
  "weather_alerts",
  "boundary_admin",
  "boundary_country",
  "boundary_region",
  "boundary_district",
  "boundary_orp",
  "boundary_municipality",
  "community_places",
  "place_settlements"
];

export function createSituationDataSourceConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): SituationDataSourceConfig {
  const cacheTtlMs = readInteger(env.COP_SITUATION_DATA_CACHE_TTL_MS, defaultConfig.cacheTtlMs, 1000, 300000);
  return {
    baseUrl: trimTrailingSlash(env.COP_SITUATION_DATA_BASE_URL ?? defaultConfig.baseUrl),
    cacheMaxEntries: readInteger(
      env.COP_SITUATION_DATA_CACHE_MAX_ENTRIES,
      defaultConfig.cacheMaxEntries ?? 5000,
      1,
      100000
    ),
    cacheTtlMs,
    enabled: readBoolean(env.COP_SITUATION_DATA_ENABLED, defaultConfig.enabled),
    layerCacheTtlMs: {
      air_quality: readInteger(
        env.COP_SITUATION_DATA_AIR_QUALITY_CACHE_TTL_MS,
        15 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      air_quality_grid: readInteger(
        env.COP_SITUATION_DATA_AIR_QUALITY_GRID_CACHE_TTL_MS,
        15 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      boundary_admin: readInteger(
        env.COP_SITUATION_DATA_BOUNDARY_ADMIN_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      boundary_country: readInteger(
        env.COP_SITUATION_DATA_BOUNDARY_COUNTRY_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      boundary_district: readInteger(
        env.COP_SITUATION_DATA_BOUNDARY_DISTRICT_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      boundary_municipality: readInteger(
        env.COP_SITUATION_DATA_BOUNDARY_MUNICIPALITY_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      boundary_orp: readInteger(
        env.COP_SITUATION_DATA_BOUNDARY_ORP_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      boundary_region: readInteger(
        env.COP_SITUATION_DATA_BOUNDARY_REGION_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      community_places: readInteger(
        env.COP_SITUATION_DATA_COMMUNITY_PLACES_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      fire: readInteger(env.COP_SITUATION_DATA_FIRE_CACHE_TTL_MS, 10 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      flood: readInteger(env.COP_SITUATION_DATA_FLOOD_CACHE_TTL_MS, 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      ground: readInteger(env.COP_SITUATION_DATA_GROUND_CACHE_TTL_MS, 6 * 60 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      mobile: readInteger(env.COP_SITUATION_DATA_MOBILE_CACHE_TTL_MS, 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      mobile_coverage: readInteger(
        env.COP_SITUATION_DATA_MOBILE_COVERAGE_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      mobile_network: readInteger(
        env.COP_SITUATION_DATA_MOBILE_NETWORK_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      outdoor_webcams: readInteger(
        env.COP_SITUATION_DATA_OUTDOOR_WEBCAMS_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      trail_poi: readInteger(
        env.COP_SITUATION_DATA_TRAIL_POI_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      trail_routes: readInteger(
        env.COP_SITUATION_DATA_TRAIL_ROUTES_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      traffic: readInteger(env.COP_SITUATION_DATA_TRAFFIC_CACHE_TTL_MS, cacheTtlMs, 1000, 5 * 60 * 1000),
      warnings: readInteger(env.COP_SITUATION_DATA_WARNINGS_CACHE_TTL_MS, 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      weather: readInteger(env.COP_SITUATION_DATA_WEATHER_CACHE_TTL_MS, 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      weather_alerts: readInteger(
        env.COP_SITUATION_DATA_WEATHER_ALERTS_CACHE_TTL_MS,
        5 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_forecast_area: readInteger(
        env.COP_SITUATION_DATA_WEATHER_FORECAST_AREA_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_webcams: readInteger(
        env.COP_SITUATION_DATA_WEATHER_WEBCAMS_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_humidity_grid: readInteger(
        env.COP_SITUATION_DATA_WEATHER_HUMIDITY_GRID_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_precipitation_grid: readInteger(
        env.COP_SITUATION_DATA_WEATHER_PRECIPITATION_GRID_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_pressure_grid: readInteger(
        env.COP_SITUATION_DATA_WEATHER_PRESSURE_GRID_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_radar_nowcast: readInteger(
        env.COP_SITUATION_DATA_WEATHER_RADAR_NOWCAST_CACHE_TTL_MS,
        5 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_radar_precipitation: readInteger(
        env.COP_SITUATION_DATA_WEATHER_RADAR_PRECIPITATION_CACHE_TTL_MS,
        5 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_radar_reflectivity: readInteger(
        env.COP_SITUATION_DATA_WEATHER_RADAR_REFLECTIVITY_CACHE_TTL_MS,
        5 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_temperature_grid: readInteger(
        env.COP_SITUATION_DATA_WEATHER_TEMPERATURE_GRID_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_thunderstorm_risk: readInteger(
        env.COP_SITUATION_DATA_WEATHER_THUNDERSTORM_RISK_CACHE_TTL_MS,
        5 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_wind_field: readInteger(
        env.COP_SITUATION_DATA_WEATHER_WIND_FIELD_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      )
    },
    maxLimit: readInteger(env.COP_SITUATION_DATA_MAX_LIMIT, defaultConfig.maxLimit, 1, 5000),
    sourceCacheTtlMs: {
      ardos_partner: readInteger(env.COP_SITUATION_DATA_ARDOS_CACHE_TTL_MS, 10 * 1000, 1000, 5 * 60 * 1000),
      aviation_weather: readInteger(
        env.COP_SITUATION_DATA_AVIATION_WEATHER_CACHE_TTL_MS,
        120 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      chmi_air_quality: readInteger(
        env.COP_SITUATION_DATA_CHMI_AIR_QUALITY_CACHE_TTL_MS,
        15 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      chmi_weather_radar: readInteger(
        env.COP_SITUATION_DATA_CHMI_WEATHER_RADAR_CACHE_TTL_MS,
        5 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      chmi_weather_stations: readInteger(
        env.COP_SITUATION_DATA_CHMI_WEATHER_STATIONS_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      chmi_weather_webcams: readInteger(
        env.COP_SITUATION_DATA_CHMI_WEATHER_WEBCAMS_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      community_context: readInteger(
        env.COP_SITUATION_DATA_COMMUNITY_CONTEXT_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      weather_forecast: readInteger(
        env.COP_SITUATION_DATA_WEATHER_FORECAST_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      mobile_coverage_model: readInteger(
        env.COP_SITUATION_DATA_MOBILE_COVERAGE_MODEL_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      mobile_network_model: readInteger(
        env.COP_SITUATION_DATA_MOBILE_NETWORK_MODEL_CACHE_TTL_MS,
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      ),
      osm_postgis: readInteger(
        env.COP_SITUATION_DATA_OSM_POSTGIS_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000
      )
    },
    staleIfErrorMs: readInteger(
      env.COP_SITUATION_DATA_STALE_IF_ERROR_MS,
      defaultConfig.staleIfErrorMs ?? 600000,
      0,
      24 * 60 * 60 * 1000
    ),
    timeoutMs: readInteger(env.COP_SITUATION_DATA_TIMEOUT_MS, defaultConfig.timeoutMs, 1000, 60000)
  };
}

export function createSituationDataSourceFromEnv(
  env: Record<string, string | undefined> = process.env
): SituationDataSource | undefined {
  const config = createSituationDataSourceConfigFromEnv(env);
  return config.enabled ? new SituationDataSourceAdapter(config) : undefined;
}

export class SituationDataSourceAdapter implements SituationDataSource {
  readonly sourceSystem: SourceSystem;
  private readonly featureCache: ManagedSituationCache<SituationFeatureCollection>;
  private catalogCache: { expiresAtMs: number; value: ProviderMapCatalog } | null = null;
  private catalogInflight: Promise<ProviderMapCatalog> | null = null;
  private layerCache: { expiresAtMs: number; value: SituationLayerDescriptor[] } | null = null;
  private sourceCache: { expiresAtMs: number; value: SituationSourceDescriptor[] } | null = null;
  private taxonomyCache: { expiresAtMs: number; value: ProviderTaxonomy } | null = null;
  private taxonomyInflight: Promise<ProviderTaxonomy> | null = null;

  constructor(readonly config: SituationDataSourceConfig) {
    this.sourceSystem = createPublicSituationAggregateSourceSystem();
    this.featureCache = new ManagedSituationCache<SituationFeatureCollection>({
      maxEntries: cacheMaxEntries(config),
      staleIfErrorMs: staleIfErrorMs(config)
    });
  }

  cacheStats(): SituationDataCacheStats {
    return this.featureCache.stats();
  }

  async fetchCatalog(requestNow: Date): Promise<ProviderMapCatalog> {
    if (this.catalogCache && this.catalogCache.expiresAtMs > requestNow.getTime()) {
      return this.catalogCache.value;
    }
    if (this.catalogInflight) {
      return this.catalogInflight;
    }
    this.catalogInflight = fetchSituationCatalog(this.config, requestNow);
    try {
      const value = await this.catalogInflight;
      this.catalogCache = {
        expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
        value
      };
      return value;
    } finally {
      this.catalogInflight = null;
    }
  }

  async fetchLayers(requestNow: Date): Promise<SituationLayerDescriptor[]> {
    if (this.layerCache && this.layerCache.expiresAtMs > requestNow.getTime()) {
      return this.layerCache.value;
    }
    const layers = situationLayersFromProviderCatalog(await this.fetchCatalog(requestNow));
    this.layerCache = {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value: layers
    };
    return layers;
  }

  async fetchSources(requestNow: Date): Promise<SituationSourceDescriptor[]> {
    if (this.sourceCache && this.sourceCache.expiresAtMs > requestNow.getTime()) {
      return this.sourceCache.value;
    }
    const sources = situationSourcesFromProviderCatalog(await this.fetchCatalog(requestNow));
    this.sourceCache = {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value: sources
    };
    return sources;
  }

  async fetchTaxonomy(requestNow: Date): Promise<ProviderTaxonomy> {
    if (this.taxonomyCache && this.taxonomyCache.expiresAtMs > requestNow.getTime()) {
      return this.taxonomyCache.value;
    }
    if (this.taxonomyInflight) {
      return this.taxonomyInflight;
    }
    this.taxonomyInflight = fetchSituationTaxonomy(this.config, requestNow);
    try {
      const value = await this.taxonomyInflight;
      this.taxonomyCache = {
        expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
        value
      };
      return value;
    } finally {
      this.taxonomyInflight = null;
    }
  }

  async fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
    const normalizedQuery = normalizeSituationFeatureQuery(query, this.config);
    const collection = shouldUseChunkedMobileNetworkQuery(normalizedQuery)
      ? await this.fetchChunkedMobileNetworkFeatures(normalizedQuery, requestNow)
      : await this.fetchFeaturesUnchunked(normalizedQuery, requestNow);
    if (!shouldUseMobileNetworkCoverageFallback(normalizedQuery, collection)) {
      return collection;
    }
    return this.fetchMobileNetworkCoverageFallback(normalizedQuery, collection, requestNow);
  }

  async fetchMobileTowerViewshed(
    towerId: string,
    query: MobileTowerViewshedQuery,
    requestNow: Date
  ): Promise<MobileTowerViewshedResponse> {
    return fetchMobileTowerViewshed(this.config, towerId, query, requestNow);
  }

  async createRadioProfile(profile: RadioProfile, requestNow: Date): Promise<RadioProfilesResponse> {
    return createRadioProfile(this.config, profile, requestNow);
  }

  async fetchRadioProfiles(requestNow: Date): Promise<RadioProfilesResponse> {
    return fetchRadioProfiles(this.config, requestNow);
  }

  async runRadioCoverage(request: RadioCoverageRequest, requestNow: Date): Promise<RadioFeatureCollectionResponse> {
    return runRadioCoverage(this.config, request, requestNow);
  }

  async runRadioLinkCheck(request: RadioLinkCheckRequest, requestNow: Date): Promise<RadioLinkCheckResponse> {
    return runRadioLinkCheck(this.config, request, requestNow);
  }

  async runRadioSiteSearch(request: RadioSiteSearchRequest, requestNow: Date): Promise<RadioFeatureCollectionResponse> {
    return runRadioSiteSearch(this.config, request, requestNow);
  }

  private async fetchFeaturesUnchunked(
    normalizedQuery: SituationFeatureQuery,
    requestNow: Date
  ): Promise<SituationFeatureCollection> {
    const upstreamQuery = canonicalizeSituationFeatureQuery(normalizedQuery);
    const cacheKey = situationFeatureCacheKey(upstreamQuery);
    const ttlMs =
      cacheTtlMsForSources(normalizedQuery.sources, this.config) ??
      cacheTtlMsForLayers(normalizedQuery.layers, this.config);
    const cached = await this.featureCache.getOrLoad(cacheKey, ttlMs, () =>
      fetchSituationFeatures(this.config, upstreamQuery, requestNow)
    );
    return projectSituationFeatureCollection(cached.value, normalizedQuery, {
      cacheKey,
      cacheStatus: cached.status,
      ttlMs,
      upstreamBbox: upstreamQuery.bbox
    });
  }

  private async fetchChunkedMobileNetworkFeatures(
    normalizedQuery: SituationFeatureQuery,
    requestNow: Date
  ): Promise<SituationFeatureCollection> {
    const nonMobileLayers = normalizedQuery.layers.filter((layer) => layer !== "mobile_network");
    const mobileSources = normalizedQuery.sources?.filter((source) => source === "mobile_network_model");
    const nonMobileSources = normalizedQuery.sources?.filter((source) => source !== "mobile_network_model");
    const mobileChunks = splitBbox(normalizedQuery.bbox, mobileNetworkChunkDegrees);
    const perChunkLimit = Math.max(
      1,
      Math.min(
        this.config.maxLimit,
        Math.ceil(normalizedQuery.limit / mobileChunks.length) + mobileNetworkChunkLimitSlack
      )
    );
    const [nonMobileCollection, ...mobileCollections] = await Promise.all([
      nonMobileLayers.length > 0
        ? this.fetchFeaturesUnchunked(
            {
              ...normalizedQuery,
              layers: nonMobileLayers,
              ...(nonMobileSources && nonMobileSources.length > 0 ? { sources: nonMobileSources } : {})
            },
            requestNow
          )
        : Promise.resolve(
            emptySituationFeatureCollection(
              {
                ...normalizedQuery,
                layers: [],
                ...(nonMobileSources && nonMobileSources.length > 0 ? { sources: nonMobileSources } : {})
              },
              requestNow
            )
          ),
      ...mobileChunks.map((bbox) =>
        this.fetchFeaturesUnchunked(
          {
            bbox,
            layers: ["mobile_network"],
            limit: perChunkLimit,
            ...(mobileSources && mobileSources.length > 0 ? { sources: mobileSources } : {}),
            ...(normalizedQuery.technology ? { technology: normalizedQuery.technology } : {})
          },
          requestNow
        )
      )
    ]);

    return mergeSituationFeatureCollections([nonMobileCollection, ...mobileCollections], normalizedQuery, requestNow);
  }

  private async fetchMobileNetworkCoverageFallback(
    normalizedQuery: SituationFeatureQuery,
    primaryCollection: SituationFeatureCollection,
    requestNow: Date
  ): Promise<SituationFeatureCollection> {
    const fallbackLimit = Math.max(1, normalizedQuery.limit - primaryCollection.features.length);
    const fallbackCollection = await this.fetchFeaturesUnchunked(
      {
        bbox: normalizedQuery.bbox,
        layers: ["mobile_coverage"],
        limit: fallbackLimit,
        sources: ["mobile_coverage_model"],
        ...(normalizedQuery.technology ? { technology: normalizedQuery.technology } : {})
      },
      requestNow
    );
    if (fallbackCollection.features.length === 0) {
      return primaryCollection;
    }
    return mergeSituationFeatureCollections([primaryCollection, fallbackCollection], normalizedQuery, requestNow, [
      "mobile_network_model returned no public read-model cells; COP is showing mobile_coverage_model as a model-only fallback."
    ]);
  }
}

interface ManagedSituationCacheOptions {
  maxEntries: number;
  staleIfErrorMs: number;
}

interface SituationCacheEntry<T> {
  expiresAtMs: number;
  lastAccessedAtMs: number;
  staleUntilMs: number;
  value: T;
}

interface SituationCacheLoadResult<T> {
  status: SituationCacheStatus;
  value: T;
}

class ManagedSituationCache<T> {
  private readonly entries = new Map<string, SituationCacheEntry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly counters = {
    coalescedHits: 0,
    errors: 0,
    evictions: 0,
    hits: 0,
    misses: 0,
    refreshes: 0,
    staleHits: 0
  };

  constructor(private readonly options: ManagedSituationCacheOptions) {}

  async getOrLoad(key: string, ttlMs: number, loader: () => Promise<T>): Promise<SituationCacheLoadResult<T>> {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (entry && entry.expiresAtMs > now) {
      this.counters.hits += 1;
      entry.lastAccessedAtMs = now;
      return { status: "hit", value: entry.value };
    }

    const existingInflight = this.inflight.get(key);
    if (existingInflight) {
      this.counters.coalescedHits += 1;
      return { status: "coalesced", value: await existingInflight };
    }

    this.counters.misses += 1;
    const refresh = loader()
      .then((value) => {
        this.counters.refreshes += 1;
        this.store(key, value, ttlMs);
        return value;
      })
      .catch((error) => {
        this.counters.errors += 1;
        const staleEntry = this.entries.get(key);
        if (staleEntry && staleEntry.staleUntilMs > Date.now()) {
          this.counters.staleHits += 1;
          staleEntry.lastAccessedAtMs = Date.now();
          return staleEntry.value;
        }
        throw error;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, refresh);
    const value = await refresh;
    const refreshedEntry = this.entries.get(key);
    return { status: refreshedEntry && refreshedEntry.expiresAtMs > Date.now() ? "miss" : "stale", value };
  }

  stats(): SituationDataCacheStats {
    return {
      entries: this.entries.size,
      inflight: this.inflight.size,
      ...this.counters
    };
  }

  private store(key: string, value: T, ttlMs: number): void {
    const now = Date.now();
    this.entries.set(key, {
      expiresAtMs: now + Math.max(0, ttlMs),
      lastAccessedAtMs: now,
      staleUntilMs: now + Math.max(0, ttlMs) + Math.max(0, this.options.staleIfErrorMs),
      value
    });
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    const maxEntries = Math.max(1, this.options.maxEntries);
    while (this.entries.size > maxEntries) {
      const oldest = Array.from(this.entries.entries()).sort(
        (a, b) => a[1].lastAccessedAtMs - b[1].lastAccessedAtMs
      )[0];
      if (!oldest) {
        return;
      }
      this.entries.delete(oldest[0]);
      this.counters.evictions += 1;
    }
  }
}

export function buildSituationDataHealth(
  response: SituationFeatureCollection | SituationLayerDescriptor[],
  requestNow: Date,
  taxonomy?: ProviderTaxonomy
): SourceHealthOverride {
  if (Array.isArray(response)) {
    return {
      detail: `layers ${response.length}`,
      evaluatedAt: requestNow.toISOString(),
      health: response.length > 0 ? "ONLINE" : "WAITING",
      lastPollAt: requestNow.toISOString(),
      lastSuccessAt: requestNow.toISOString(),
      summary: {
        layerCount: response.length,
        ...taxonomyHealthSummary(taxonomy)
      },
      ...(taxonomy?.warnings.length ? { warnings: taxonomy.warnings } : {})
    };
  }

  const warnings = uniqueStrings([...response.warnings, ...(taxonomy?.warnings ?? [])]);
  const reportedWarningCount = response.summary.warningCount;
  const warningCount = warnings.length || reportedWarningCount;
  const operationalWarningCount = warnings.filter(isOperationalSituationWarning).length;
  const hasUnclassifiedWarnings = warnings.length === 0 && reportedWarningCount > 0;
  const health: SourceHealthOverride["health"] =
    response.summary.staleFeatureCount > 0
      ? "STALE"
      : operationalWarningCount > 0 || hasUnclassifiedWarnings
        ? "DEGRADED"
        : "ONLINE";
  return {
    detail: `features ${response.summary.featureCount}, stale ${response.summary.staleFeatureCount}, warnings ${warningCount}`,
    evaluatedAt: requestNow.toISOString(),
    generatedAt: response.generatedAt,
    health,
    lastPollAt: requestNow.toISOString(),
    lastSuccessAt: requestNow.toISOString(),
    summary: {
      featureCount: response.summary.featureCount,
      sourceCount: response.summary.sourceCount,
      staleFeatureCount: response.summary.staleFeatureCount,
      warningCount,
      ...taxonomyHealthSummary(taxonomy)
    },
    warnings
  };
}

function isOperationalSituationWarning(warning: string): boolean {
  const normalized = warning.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("operator_feed_unavailable") ||
    normalized.includes("no_operator_bts_status") ||
    /operator.*feed.*unavailable/.test(normalized) ||
    /bts.*status.*unavailable/.test(normalized) ||
    normalized.includes("modelový odhad") ||
    normalized.includes("model-only") ||
    normalized.includes("inferred assessment")
  ) {
    return false;
  }
  return /\b(unavailable|failed|failure|timeout|timed out|error|refused|stale|disabled|invalid|unauthorized|forbidden|degraded|empty|missing)\b/.test(
    normalized
  );
}

export function unavailableSituationDataHealth(error: unknown, requestNow: Date): SourceHealthOverride {
  return {
    detail: "Situation data source is unavailable.",
    evaluatedAt: requestNow.toISOString(),
    health: "UNAVAILABLE",
    lastError: error instanceof Error ? error.message : "unknown error",
    lastPollAt: requestNow.toISOString(),
    warnings: ["Situation data request failed."]
  };
}

export function emptySituationFeatureCollection(
  query: SituationFeatureQuery,
  requestNow: Date,
  warnings: string[] = []
): SituationFeatureCollection {
  return {
    contractVersion: "cop-situation-source-v1",
    features: [],
    generatedAt: requestNow.toISOString(),
    query,
    source: {
      generatedAt: requestNow.toISOString(),
      sourceId: "situation-data-api",
      sourceType: "PUBLIC_SITUATION_AGGREGATE"
    },
    sources: [],
    summary: {
      featureCount: 0,
      sourceCount: 0,
      staleFeatureCount: 0,
      warningCount: warnings.length
    },
    type: "FeatureCollection",
    warnings
  };
}

export function parseSituationFeatureQuery(
  rawQuery: Record<string, unknown>,
  config: SituationDataSourceConfig
): SituationFeatureQuery | null {
  const bbox = typeof rawQuery.bbox === "string" ? parseSituationBbox(rawQuery.bbox) : null;
  if (!bbox) {
    return null;
  }
  return normalizeSituationFeatureQuery(
    {
      bbox,
      layers: parseSituationLayers(typeof rawQuery.layers === "string" ? rawQuery.layers : undefined),
      limit: optionalNumber(rawQuery.limit) ?? config.maxLimit,
      sources: parseSituationSources(rawQuery),
      technology: parseCoverageTechnology(rawQuery.technology ?? rawQuery.technologies)
    },
    config
  );
}

export function normalizeSituationFeatureQuery(
  query: SituationFeatureQuery,
  config: SituationDataSourceConfig
): SituationFeatureQuery {
  return {
    bbox: {
      east: clampNumber(query.bbox.east, -180, 180),
      north: clampNumber(query.bbox.north, -90, 90),
      south: clampNumber(query.bbox.south, -90, 90),
      west: clampNumber(query.bbox.west, -180, 180)
    },
    layers:
      query.layers.filter(isSituationLayerId).length > 0
        ? uniqueLayers(query.layers.filter(isSituationLayerId))
        : ["weather"],
    limit: Math.round(clampNumber(query.limit, 1, config.maxLimit)),
    ...(query.sources && query.sources.length > 0 ? { sources: uniqueStrings(query.sources) } : {}),
    ...(query.technology ? { technology: normalizeCoverageTechnology(query.technology) } : {})
  };
}

interface ProjectSituationFeatureCollectionOptions {
  cacheKey: string;
  cacheStatus: SituationCacheStatus;
  ttlMs: number;
  upstreamBbox: SituationBbox;
}

const mobileNetworkChunkDegrees = 1;
const mobileNetworkChunkLimitSlack = 8;
const mobileNetworkChunkMinDimensionDegrees = 1.2;
const mobileNetworkMaxChunks = 64;

function canonicalizeSituationFeatureQuery(query: SituationFeatureQuery): SituationFeatureQuery {
  if (shouldUseExactBboxForDenseGridQuery(query)) {
    return {
      bbox: query.bbox,
      layers: query.layers,
      limit: query.limit,
      ...(query.sources && query.sources.length > 0 ? { sources: query.sources } : {}),
      ...(query.technology ? { technology: query.technology } : {})
    };
  }
  const gridSizeDegrees = gridSizeDegreesForBbox(query.bbox);
  const paddedBbox = padBbox(query.bbox, 0.18);
  return {
    bbox: snapBboxToGrid(paddedBbox, gridSizeDegrees),
    layers: query.layers,
    limit: query.limit,
    ...(query.sources && query.sources.length > 0 ? { sources: query.sources } : {}),
    ...(query.technology ? { technology: query.technology } : {})
  };
}

function shouldUseExactBboxForDenseGridQuery(query: SituationFeatureQuery): boolean {
  return query.layers.some((layer) => layer === "mobile_coverage" || layer === "mobile_network");
}

function projectSituationFeatureCollection(
  collection: SituationFeatureCollection,
  requestQuery: SituationFeatureQuery,
  options: ProjectSituationFeatureCollectionOptions
): SituationFeatureCollection {
  const features = collection.features.filter(
    (feature) =>
      requestQuery.layers.includes(feature.properties.layer) &&
      (!requestQuery.sources || requestQuery.sources.includes(feature.properties.sourceId)) &&
      (!requestQuery.technology ||
        !isTechnologyFilteredLayer(feature.properties.layer) ||
        feature.properties.technology === requestQuery.technology) &&
      isFeatureInBbox(feature, requestQuery.bbox)
  );
  const sources = collection.sources.filter(
    (source) => !requestQuery.sources || requestQuery.sources.includes(source.sourceId)
  );
  const warnings =
    options.cacheStatus === "stale"
      ? [...collection.warnings, "COP served stale situation-data cache because SIM refresh failed."]
      : collection.warnings;
  return {
    ...collection,
    cache: {
      key: options.cacheKey,
      status: options.cacheStatus,
      ttlMs: options.ttlMs,
      upstreamBbox: options.upstreamBbox
    },
    features,
    generatedAt: collection.generatedAt,
    query: {
      bbox: requestQuery.bbox,
      layers: requestQuery.layers,
      limit: requestQuery.limit,
      sources: requestQuery.sources ?? collection.query.sources,
      technology: requestQuery.technology ?? collection.query.technology
    },
    sources,
    summary: {
      featureCount: features.length,
      sourceCount: requestQuery.sources ? sources.length : collection.summary.sourceCount,
      staleFeatureCount: features.filter((feature) => feature.properties.stale).length,
      warningCount: warnings.length
    },
    warnings
  };
}

function shouldUseChunkedMobileNetworkQuery(query: SituationFeatureQuery): boolean {
  if (!query.layers.includes("mobile_network")) {
    return false;
  }
  if (query.sources && !query.sources.includes("mobile_network_model")) {
    return false;
  }
  const width = Math.abs(query.bbox.east - query.bbox.west);
  const height = Math.abs(query.bbox.north - query.bbox.south);
  if (Math.max(width, height) < mobileNetworkChunkMinDimensionDegrees) {
    return false;
  }
  return splitBbox(query.bbox, mobileNetworkChunkDegrees).length <= mobileNetworkMaxChunks;
}

function shouldUseMobileNetworkCoverageFallback(
  query: SituationFeatureQuery,
  collection: SituationFeatureCollection
): boolean {
  if (!query.layers.includes("mobile_network")) {
    return false;
  }
  if (query.sources && !query.sources.includes("mobile_network_model")) {
    return false;
  }
  return !collection.features.some((feature) => feature.properties.layer === "mobile_network");
}

function splitBbox(bbox: SituationBbox, maxDimensionDegrees: number): SituationBbox[] {
  const width = Math.max(0.001, bbox.east - bbox.west);
  const height = Math.max(0.001, bbox.north - bbox.south);
  const lonSteps = Math.max(1, Math.ceil(width / maxDimensionDegrees));
  const latSteps = Math.max(1, Math.ceil(height / maxDimensionDegrees));
  const lonStep = width / lonSteps;
  const latStep = height / latSteps;
  const chunks: SituationBbox[] = [];
  for (let latIndex = 0; latIndex < latSteps; latIndex += 1) {
    for (let lonIndex = 0; lonIndex < lonSteps; lonIndex += 1) {
      chunks.push({
        east: round(lonIndex === lonSteps - 1 ? bbox.east : bbox.west + lonStep * (lonIndex + 1), 6),
        north: round(latIndex === latSteps - 1 ? bbox.north : bbox.south + latStep * (latIndex + 1), 6),
        south: round(bbox.south + latStep * latIndex, 6),
        west: round(bbox.west + lonStep * lonIndex, 6)
      });
    }
  }
  return chunks;
}

function mergeSituationFeatureCollections(
  collections: SituationFeatureCollection[],
  query: SituationFeatureQuery,
  requestNow: Date,
  extraWarnings: string[] = []
): SituationFeatureCollection {
  const featuresById = new Map<string, SituationFeature>();
  for (const collection of collections) {
    for (const feature of collection.features) {
      const id = String(
        feature.properties.featureId || feature.id || `${feature.properties.layer}:${featuresById.size}`
      );
      if (!featuresById.has(id) && isFeatureInBbox(feature, query.bbox)) {
        featuresById.set(id, feature);
      }
    }
  }
  const features = Array.from(featuresById.values()).slice(0, query.limit);
  const sourcesById = new Map<string, SituationSourceDescriptor>();
  for (const collection of collections) {
    for (const source of collection.sources) {
      if (!sourcesById.has(source.sourceId)) {
        sourcesById.set(source.sourceId, source);
      }
    }
  }
  const warnings = uniqueStrings([...collections.flatMap((collection) => collection.warnings), ...extraWarnings]);
  return {
    contractVersion: "cop-situation-source-v1",
    features,
    generatedAt: requestNow.toISOString(),
    query,
    source: {
      generatedAt: requestNow.toISOString(),
      sourceId: "situation-data-api",
      sourceType: "PUBLIC_SITUATION_AGGREGATE"
    },
    sources: Array.from(sourcesById.values()),
    summary: {
      featureCount: features.length,
      sourceCount: sourcesById.size,
      staleFeatureCount: features.filter((feature) => feature.properties.stale).length,
      warningCount: warnings.length
    },
    type: "FeatureCollection",
    warnings
  };
}

async function fetchSituationCatalog(config: SituationDataSourceConfig, requestNow: Date): Promise<ProviderMapCatalog> {
  return normalizeProviderMapCatalog(
    await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/catalog`), config, requestNow),
    "sim.situation-data"
  );
}

async function fetchSituationTaxonomy(config: SituationDataSourceConfig, requestNow: Date): Promise<ProviderTaxonomy> {
  return normalizeProviderTaxonomy(
    await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/taxonomy`), config, requestNow),
    "sim.situation-data"
  );
}

function taxonomyHealthSummary(taxonomy: ProviderTaxonomy | undefined): Record<string, unknown> {
  if (!taxonomy) {
    return {};
  }
  return {
    taxonomyCount: taxonomy.taxonomies.length,
    taxonomyEntryCount: providerTaxonomyEntryCount(taxonomy),
    ...(taxonomy.generatedAt ? { taxonomyGeneratedAt: taxonomy.generatedAt } : {})
  };
}

function situationLayersFromProviderCatalog(catalog: ProviderMapCatalog): SituationLayerDescriptor[] {
  const layers = new Map<SituationLayerId, SituationLayerDescriptor>();
  for (const catalogLayer of catalog.layers) {
    for (const providerLayerId of catalogLayer.query?.providerLayerIds ?? []) {
      if (!isSituationLayerId(providerLayerId)) {
        continue;
      }
      const current = layers.get(providerLayerId);
      layers.set(providerLayerId, {
        defaultVisible: (current?.defaultVisible ?? false) || catalogLayer.defaultVisible === true,
        description: current?.description ?? catalogLayer.description,
        expectedCadenceSeconds: minOptionalNumber(current?.expectedCadenceSeconds, catalogLayer.refreshSeconds),
        geometryTypes: mergeStringLists(current?.geometryTypes, catalogLayer.geometryTypes),
        label: current?.label ?? situationLayerLabelFromCatalog(providerLayerId, catalogLayer.label),
        layerId: providerLayerId
      });
    }
  }
  return Array.from(layers.values());
}

function situationSourcesFromProviderCatalog(catalog: ProviderMapCatalog): SituationSourceDescriptor[] {
  return catalog.sources.map((source) => ({
    enabled: source.enabled,
    label: source.label,
    layers:
      source.layers?.filter(isSituationLayerId) ??
      catalog.layers
        .filter((layer) => layer.query?.providerSourceIds?.includes(source.sourceId))
        .flatMap((layer) => layer.query?.providerLayerIds ?? [])
        .filter(isSituationLayerId),
    mode: source.sourceRole,
    sourceId: source.sourceId,
    updateCadenceSeconds: source.updateCadenceSeconds
  }));
}

async function fetchSituationFeatures(
  config: SituationDataSourceConfig,
  query: SituationFeatureQuery,
  requestNow: Date
): Promise<SituationFeatureCollection> {
  const url = new URL(`${trimTrailingSlash(config.baseUrl)}/features`);
  url.searchParams.set("bbox", `${query.bbox.west},${query.bbox.south},${query.bbox.east},${query.bbox.north}`);
  url.searchParams.set("layers", query.layers.join(","));
  url.searchParams.set("limit", String(query.limit));
  if (query.sources && query.sources.length > 0) {
    url.searchParams.set("source", query.sources.join(","));
  }
  if (query.technology) {
    url.searchParams.set("technology", query.technology);
  }
  return normalizeSituationFeatureCollection(await fetchJson(url, config, requestNow), query);
}

async function fetchMobileTowerViewshed(
  config: SituationDataSourceConfig,
  towerId: string,
  query: MobileTowerViewshedQuery,
  requestNow: Date
): Promise<MobileTowerViewshedResponse> {
  const url = new URL(
    `${trimTrailingSlash(config.baseUrl)}/mobile-coverage/towers/${encodeURIComponent(towerId)}/viewshed`
  );
  url.searchParams.set("technology", query.technology);
  url.searchParams.set("radiusM", String(query.radiusM));
  url.searchParams.set("azimuthStepDeg", String(query.azimuthStepDeg));
  url.searchParams.set("distanceStepM", String(query.distanceStepM));
  return normalizeMobileTowerViewshedResponse(
    await fetchJson(url, config, requestNow, {
      timeoutMs: Math.max(config.timeoutMs, MOBILE_TOWER_VIEWSHED_TIMEOUT_MS)
    })
  );
}

async function fetchRadioProfiles(config: SituationDataSourceConfig, requestNow: Date): Promise<RadioProfilesResponse> {
  return normalizeRadioProfilesResponse(
    await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/radio/profiles`), config, requestNow)
  );
}

async function createRadioProfile(
  config: SituationDataSourceConfig,
  profile: RadioProfile,
  requestNow: Date
): Promise<RadioProfilesResponse> {
  return normalizeRadioProfilesResponse(
    await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/radio/profiles`), config, requestNow, {
      body: JSON.stringify(profile),
      method: "POST"
    })
  );
}

async function runRadioCoverage(
  config: SituationDataSourceConfig,
  request: RadioCoverageRequest,
  requestNow: Date
): Promise<RadioFeatureCollectionResponse> {
  return normalizeRadioFeatureCollectionResponse(
    await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/radio/coverage`), config, requestNow, {
      body: JSON.stringify(request),
      method: "POST"
    })
  );
}

async function runRadioLinkCheck(
  config: SituationDataSourceConfig,
  request: RadioLinkCheckRequest,
  requestNow: Date
): Promise<RadioLinkCheckResponse> {
  return normalizeRadioLinkCheckResponse(
    await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/radio/link-check`), config, requestNow, {
      body: JSON.stringify(request),
      method: "POST"
    })
  );
}

async function runRadioSiteSearch(
  config: SituationDataSourceConfig,
  request: RadioSiteSearchRequest,
  requestNow: Date
): Promise<RadioFeatureCollectionResponse> {
  return normalizeRadioFeatureCollectionResponse(
    await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/radio/site-search`), config, requestNow, {
      body: JSON.stringify(request),
      method: "POST"
    })
  );
}

type FetchJsonInit = RequestInit & { timeoutMs?: number };

class SituationDataHttpError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string, url: URL) {
    super(`${status} ${statusText || "Situation data request failed"} for ${url.pathname}`);
    this.name = "SituationDataHttpError";
    this.status = status;
  }
}

async function fetchJson(
  url: URL,
  config: SituationDataSourceConfig,
  requestNow: Date,
  init: FetchJsonInit = {}
): Promise<unknown> {
  const controller = new AbortController();
  const { timeoutMs, ...requestInit } = init;
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? config.timeoutMs);
  try {
    const response = await fetch(url, {
      ...requestInit,
      headers: {
        Accept: "application/json",
        ...(requestInit.body ? { "Content-Type": "application/json" } : {}),
        "X-COP-Request-At": requestNow.toISOString(),
        ...(requestInit.headers ?? {})
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new SituationDataHttpError(response.status, response.statusText, url);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRadioProfilesResponse(value: unknown): RadioProfilesResponse {
  if (!isRecord(value)) {
    throw new Error("Radio profiles response is not an object.");
  }
  const rawProfiles = Array.isArray(value.profiles) ? value.profiles : Array.isArray(value.items) ? value.items : [];
  return {
    contractVersion: optionalString(value.contractVersion),
    generatedAt: optionalString(value.generatedAt),
    profiles: rawProfiles.flatMap(normalizeRadioProfile),
    warnings: warningStrings(value.warnings)
  };
}

function normalizeRadioProfile(value: unknown): RadioProfile[] {
  if (!isRecord(value)) {
    return [];
  }
  const name = optionalString(value.name);
  const frequencyMhz = numberValue(value.frequencyMhz);
  const antennaHeightM = numberValue(value.antennaHeightM);
  const receiverHeightM = numberValue(value.receiverHeightM);
  const maxRadiusM = numberValue(value.maxRadiusM);
  if (
    !name ||
    frequencyMhz === undefined ||
    antennaHeightM === undefined ||
    receiverHeightM === undefined ||
    maxRadiusM === undefined
  ) {
    return [];
  }
  return [
    {
      antennaGainDbi: numberValue(value.antennaGainDbi),
      antennaHeightM,
      frequencyMhz,
      maxRadiusM,
      name,
      profileId: optionalString(value.profileId),
      receiverHeightM,
      receiverSensitivityDbm: numberValue(value.receiverSensitivityDbm),
      requiredFresnelClearancePct: numberValue(value.requiredFresnelClearancePct),
      systemLossDb: numberValue(value.systemLossDb),
      txPowerW: numberValue(value.txPowerW)
    }
  ];
}

function normalizeRadioFeatureCollectionResponse(value: unknown): RadioFeatureCollectionResponse {
  if (!isRecord(value) || value.type !== "FeatureCollection") {
    throw new Error("Radio LoS response does not contain a GeoJSON FeatureCollection.");
  }
  return {
    contractVersion: optionalString(value.contractVersion),
    features: Array.isArray(value.features) ? value.features.flatMap(normalizeMobileTowerViewshedFeature) : [],
    generatedAt: optionalString(value.generatedAt),
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    providerId: optionalString(value.providerId),
    summary: isRecord(value.summary) ? value.summary : undefined,
    type: "FeatureCollection",
    warnings: warningStrings(value.warnings)
  };
}

function normalizeRadioLinkCheckResponse(value: unknown): RadioLinkCheckResponse {
  if (!isRecord(value)) {
    throw new Error("Radio link-check response is not an object.");
  }
  const profileSamples = Array.isArray(value.profileSamples) ? value.profileSamples.filter(isRecord) : undefined;
  const derived = deriveRadioLinkCheckMetrics(profileSamples);
  return {
    azimuthDeg: numberValue(value.azimuthDeg) ?? derived.azimuthDeg,
    contractVersion: optionalString(value.contractVersion),
    distanceM: numberValue(value.distanceM) ?? derived.distanceM,
    fresnelClearancePct: numberValue(value.fresnelClearancePct) ?? derived.fresnelClearancePct,
    generatedAt: optionalString(value.generatedAt),
    linkStatus: optionalString(value.linkStatus) ?? derived.linkStatus,
    maxObstructionM: numberValue(value.maxObstructionM) ?? derived.maxObstructionM,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    profile: isRecord(value.profile) ? value.profile : undefined,
    profileSamples,
    requiredExtraAntennaHeightM: numberValue(value.requiredExtraAntennaHeightM) ?? derived.requiredExtraAntennaHeightM,
    summary: isRecord(value.summary) ? value.summary : undefined,
    warnings: warningStrings(value.warnings)
  };
}

function deriveRadioLinkCheckMetrics(
  samples: Array<Record<string, unknown>> | undefined
): Partial<RadioLinkCheckResponse> {
  if (!samples || samples.length === 0) {
    return { linkStatus: "unknown" };
  }
  const distances = samples.flatMap((sample) => {
    const value = numberValue(sample.distanceM);
    return value === undefined ? [] : [value];
  });
  const fresnelClearances = samples.flatMap((sample) => {
    const value = numberValue(sample.fresnelClearanceM);
    return value === undefined ? [] : [value];
  });
  const terrainClearances = samples.flatMap((sample) => {
    const value = numberValue(sample.terrainClearanceM);
    return value === undefined ? [] : [value];
  });
  const minFresnelClearanceM = fresnelClearances.length > 0 ? Math.min(...fresnelClearances) : undefined;
  const minTerrainClearanceM = terrainClearances.length > 0 ? Math.min(...terrainClearances) : undefined;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const firstLon = numberValue(first?.lon);
  const firstLat = numberValue(first?.lat);
  const lastLon = numberValue(last?.lon);
  const lastLat = numberValue(last?.lat);
  const hasBlockedLineOfSight = samples.some((sample) => sample.lineOfSightClear === false);
  const requiredExtraAntennaHeightM =
    minFresnelClearanceM !== undefined && minFresnelClearanceM < 0 ? Math.abs(minFresnelClearanceM) : undefined;
  const maxObstructionM =
    minTerrainClearanceM !== undefined && minTerrainClearanceM < 0 ? Math.abs(minTerrainClearanceM) : undefined;
  const fresnelClearancePct =
    minFresnelClearanceM === undefined
      ? undefined
      : Math.max(0, Math.min(100, minFresnelClearanceM >= 0 ? 100 : 60 + minFresnelClearanceM * 10));
  const linkStatus =
    minFresnelClearanceM === undefined
      ? hasBlockedLineOfSight
        ? "obstructed"
        : "unknown"
      : minFresnelClearanceM >= 0 && !hasBlockedLineOfSight
        ? "clear"
        : minFresnelClearanceM >= -5
          ? "marginal"
          : "obstructed";
  return {
    ...(firstLon !== undefined && firstLat !== undefined && lastLon !== undefined && lastLat !== undefined
      ? { azimuthDeg: bearingDeg(firstLon, firstLat, lastLon, lastLat) }
      : {}),
    ...(distances.length > 0 ? { distanceM: Math.max(...distances) } : {}),
    ...(fresnelClearancePct !== undefined ? { fresnelClearancePct } : {}),
    linkStatus,
    ...(maxObstructionM !== undefined ? { maxObstructionM } : {}),
    ...(requiredExtraAntennaHeightM !== undefined ? { requiredExtraAntennaHeightM } : {})
  };
}

function bearingDeg(fromLon: number, fromLat: number, toLon: number, toLat: number): number {
  const phi1 = (fromLat * Math.PI) / 180;
  const phi2 = (toLat * Math.PI) / 180;
  const deltaLon = ((toLon - fromLon) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function warningStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((warning): warning is string => typeof warning === "string") : [];
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeMobileTowerViewshedResponse(value: unknown): MobileTowerViewshedResponse {
  if (
    !isRecord(value) ||
    value.contractVersion !== "sim-mobile-coverage-tower-viewshed-v1" ||
    value.type !== "FeatureCollection"
  ) {
    throw new Error("Mobile tower viewshed response does not match sim-mobile-coverage-tower-viewshed-v1.");
  }
  return {
    contractVersion: "sim-mobile-coverage-tower-viewshed-v1",
    features: Array.isArray(value.features) ? value.features.flatMap(normalizeMobileTowerViewshedFeature) : [],
    generatedAt: optionalString(value.generatedAt),
    providerId: optionalString(value.providerId),
    summary: isRecord(value.summary) ? value.summary : undefined,
    tower: isRecord(value.tower) ? value.tower : undefined,
    type: "FeatureCollection",
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : []
  };
}

function normalizeMobileTowerViewshedFeature(value: unknown): MobileTowerViewshedFeature[] {
  if (!isRecord(value) || value.type !== "Feature" || !isRecord(value.properties)) {
    return [];
  }
  const geometry = normalizeGeometry(value.geometry);
  if (!geometry) {
    return [];
  }
  return [
    {
      geometry,
      id: typeof value.id === "string" || typeof value.id === "number" ? value.id : undefined,
      properties: value.properties,
      type: "Feature"
    }
  ];
}

function normalizeSituationFeatureCollection(
  value: unknown,
  fallbackQuery: SituationFeatureQuery
): SituationFeatureCollection {
  if (!isRecord(value) || value.contractVersion !== "cop-situation-source-v1" || value.type !== "FeatureCollection") {
    throw new Error("Situation data response does not match cop-situation-source-v1.");
  }
  if (
    !isRecord(value.source) ||
    value.source.sourceId !== "situation-data-api" ||
    value.source.sourceType !== "PUBLIC_SITUATION_AGGREGATE"
  ) {
    throw new Error("Situation data source descriptor is not valid.");
  }
  return {
    contractVersion: "cop-situation-source-v1",
    features: Array.isArray(value.features) ? value.features.flatMap(normalizeSituationFeature) : [],
    generatedAt: optionalString(value.generatedAt) ?? new Date().toISOString(),
    query: normalizeResponseQuery(value.query, fallbackQuery),
    source: {
      generatedAt: optionalString(value.source.generatedAt),
      sourceId: "situation-data-api",
      sourceType: "PUBLIC_SITUATION_AGGREGATE"
    },
    sources: Array.isArray(value.sources) ? value.sources.flatMap(normalizeSituationSourceDescriptor) : [],
    summary: normalizeSituationSummary(value.summary, Array.isArray(value.features) ? value.features.length : 0),
    type: "FeatureCollection",
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : []
  };
}

function normalizeSituationLayer(value: unknown): SituationLayerDescriptor[] {
  if (!isRecord(value) || !isSituationLayerId(value.layerId) || typeof value.label !== "string") {
    return [];
  }
  return [
    {
      defaultVisible: value.defaultVisible === true,
      description: optionalString(value.description),
      expectedCadenceSeconds: optionalNumber(value.expectedCadenceSeconds),
      geometryTypes: Array.isArray(value.geometryTypes)
        ? value.geometryTypes.filter((item): item is string => typeof item === "string")
        : undefined,
      label: value.label,
      layerId: value.layerId
    }
  ];
}

function normalizeSituationFeature(value: unknown): SituationFeature[] {
  if (!isRecord(value) || value.type !== "Feature" || !isRecord(value.properties)) {
    return [];
  }
  const geometry = normalizeGeometry(value.geometry);
  const properties = normalizeSituationProperties(value.properties);
  if (!geometry || !properties) {
    return [];
  }
  return [
    {
      geometry,
      id: typeof value.id === "string" || typeof value.id === "number" ? value.id : properties.featureId,
      properties,
      type: "Feature"
    }
  ];
}

function normalizeSituationProperties(value: Record<string, unknown>): SituationFeatureProperties | null {
  if (!isSituationLayerId(value.layer)) {
    return null;
  }
  const featureId = optionalString(value.featureId);
  const category = optionalString(value.category);
  const label = optionalString(value.label);
  const sourceId = optionalString(value.sourceId);
  if (!featureId || !category || !label || !sourceId) {
    return null;
  }
  const providerProperties = isRecord(value.providerProperties) ? value.providerProperties : undefined;
  const taxonomy =
    providerProperties && isRecord(providerProperties.taxonomy) ? providerProperties.taxonomy : undefined;
  return {
    assumptions: isRecord(value.assumptions) ? value.assumptions : undefined,
    btsStatus: optionalString(value.btsStatus),
    btsStatusSource: optionalString(value.btsStatusSource),
    category,
    confidence: optionalFinite(value.confidence),
    basis: optionalStringArray(value.basis),
    dataQuality: optionalString(value.dataQuality),
    demSource: optionalString(value.demSource),
    disclaimer: optionalString(value.disclaimer),
    estimatedSignalDbm: optionalNumber(value.estimatedSignalDbm),
    featureId,
    generatedAt: optionalString(value.generatedAt),
    iconHint: optionalString(value.iconHint),
    label,
    layer: value.layer,
    layerId: optionalString(value.layerId),
    license: isRecord(value.license) ? value.license : undefined,
    localized: isRecord(value.localized) ? value.localized : undefined,
    metrics: isRecord(value.metrics) ? value.metrics : undefined,
    modelVersion: optionalString(value.modelVersion),
    observedAt: optionalString(value.observedAt),
    operator: optionalString(value.operator),
    operatorStatusAvailable: optionalBoolean(value.operatorStatusAvailable),
    notices: optionalStringArray(value.notices),
    quality: optionalString(value.quality),
    providerId: optionalString(value.providerId),
    providerLayerId: optionalString(value.providerLayerId),
    providerProperties,
    readModel: optionalBoolean(value.readModel),
    rendering: isRecord(value.rendering) ? value.rendering : undefined,
    resolutionM: optionalNumber(value.resolutionM),
    severity: optionalString(value.severity),
    sourceCode:
      optionalString(value.sourceCode) ??
      optionalString(providerProperties?.sourceCode) ??
      optionalString(taxonomy?.sourceCode),
    sourceId,
    sourceSystem:
      optionalString(value.sourceSystem) ??
      optionalString(providerProperties?.sourceSystem) ??
      optionalString(taxonomy?.codeSystem) ??
      optionalString(taxonomy?.sourceSystem),
    sourceName: optionalString(value.sourceName),
    stale: typeof value.stale === "boolean" ? value.stale : undefined,
    status: optionalString(value.status),
    styleHint: optionalString(value.styleHint),
    summary: optionalString(value.summary),
    sourceRevision: optionalString(value.sourceRevision),
    tags: isRecord(value.tags) ? value.tags : undefined,
    technology: normalizeCoverageTechnology(value.technology),
    typeCode:
      optionalString(value.typeCode) ??
      optionalString(providerProperties?.typeCode) ??
      optionalString(taxonomy?.typeCode),
    validUntil: optionalString(value.validUntil)
  };
}

function normalizeSituationSourceDescriptor(value: unknown): SituationSourceDescriptor[] {
  if (!isRecord(value) || typeof value.sourceId !== "string") {
    return [];
  }
  return [
    {
      baseUrl: optionalString(value.baseUrl),
      enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
      label: optionalString(value.label),
      layers: Array.isArray(value.layers) ? value.layers.filter(isSituationLayerId) : undefined,
      license: isRecord(value.license) ? value.license : undefined,
      mode: optionalString(value.mode),
      priority: optionalNumber(value.priority),
      sourceId: value.sourceId,
      updateCadenceSeconds: optionalNumber(value.updateCadenceSeconds)
    }
  ];
}

function normalizeSituationSummary(
  value: unknown,
  fallbackFeatureCount: number
): SituationFeatureCollection["summary"] {
  const summary = isRecord(value) ? value : {};
  return {
    featureCount: optionalNumber(summary.featureCount) ?? fallbackFeatureCount,
    sourceCount: optionalNumber(summary.sourceCount) ?? 0,
    staleFeatureCount: optionalNumber(summary.staleFeatureCount) ?? 0,
    warningCount: optionalNumber(summary.warningCount) ?? 0
  };
}

function normalizeResponseQuery(value: unknown, fallback: SituationFeatureQuery): SituationFeatureCollection["query"] {
  if (!isRecord(value) || !isRecord(value.bbox)) {
    return fallback;
  }
  return {
    bbox: {
      east: optionalNumber(value.bbox.east) ?? fallback.bbox.east,
      north: optionalNumber(value.bbox.north) ?? fallback.bbox.north,
      south: optionalNumber(value.bbox.south) ?? fallback.bbox.south,
      west: optionalNumber(value.bbox.west) ?? fallback.bbox.west
    },
    layers: Array.isArray(value.layers) ? value.layers.filter(isSituationLayerId) : fallback.layers,
    limit: optionalNumber(value.limit) ?? fallback.limit,
    sources: Array.isArray(value.sources)
      ? value.sources.filter((source): source is string => typeof source === "string")
      : fallback.sources,
    technology: normalizeCoverageTechnology(value.technology) ?? fallback.technology
  };
}

function normalizeGeometry(value: unknown): SituationGeometry | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === "Point" && Array.isArray(value.coordinates)) {
    const point = tupleCoordinate(value.coordinates);
    return point ? { coordinates: point, type: "Point" } : null;
  }
  if (value.type === "LineString" && Array.isArray(value.coordinates)) {
    const coordinates = value.coordinates.flatMap((item) => {
      const point = tupleCoordinate(item);
      return point ? [point] : [];
    });
    return coordinates.length >= 2 ? { coordinates, type: "LineString" } : null;
  }
  if (value.type === "MultiLineString" && Array.isArray(value.coordinates)) {
    const lines = value.coordinates.flatMap((line) => {
      if (!Array.isArray(line)) {
        return [];
      }
      const coordinates = line.flatMap((item) => {
        const point = tupleCoordinate(item);
        return point ? [point] : [];
      });
      return coordinates.length >= 2 ? [coordinates] : [];
    });
    return lines.length > 0 ? { coordinates: lines, type: "MultiLineString" } : null;
  }
  if (value.type === "Polygon" && Array.isArray(value.coordinates)) {
    const rings = value.coordinates.flatMap((ring) => {
      if (!Array.isArray(ring)) {
        return [];
      }
      const coordinates = ring.flatMap((item) => {
        const point = tupleCoordinate(item);
        return point ? [point] : [];
      });
      return coordinates.length >= 4 ? [coordinates] : [];
    });
    return rings.length > 0 ? { coordinates: rings, type: "Polygon" } : null;
  }
  if (value.type === "MultiPolygon" && Array.isArray(value.coordinates)) {
    const polygons = value.coordinates.flatMap((polygon) => {
      if (!Array.isArray(polygon)) {
        return [];
      }
      const rings = polygon.flatMap((ring) => {
        if (!Array.isArray(ring)) {
          return [];
        }
        const coordinates = ring.flatMap((item) => {
          const point = tupleCoordinate(item);
          return point ? [point] : [];
        });
        return coordinates.length >= 4 ? [coordinates] : [];
      });
      return rings.length > 0 ? [rings] : [];
    });
    return polygons.length > 0 ? { coordinates: polygons, type: "MultiPolygon" } : null;
  }
  return null;
}

function tupleCoordinate(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [clampNumber(lon, -180, 180), clampNumber(lat, -90, 90)] : null;
}

function parseSituationBbox(value: string): SituationBbox | null {
  const [westRaw, southRaw, eastRaw, northRaw] = value.split(",");
  const west = Number(westRaw);
  const south = Number(southRaw);
  const east = Number(eastRaw);
  const north = Number(northRaw);
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) {
    return null;
  }
  return { east, north, south, west };
}

function parseSituationLayers(value: string | undefined): SituationLayerId[] {
  if (!value) {
    return ["weather"];
  }
  const layers = value
    .split(",")
    .map((item) => item.trim())
    .filter(isSituationLayerId);
  return layers.length > 0 ? uniqueLayers(layers) : ["weather"];
}

function parseSituationSources(rawQuery: Record<string, unknown>): string[] | undefined {
  const raw =
    typeof rawQuery.source === "string"
      ? rawQuery.source
      : typeof rawQuery.sources === "string"
        ? rawQuery.sources
        : undefined;
  const sources =
    raw
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];
  return sources.length > 0 ? uniqueStrings(sources) : undefined;
}

function parseCoverageTechnology(value: unknown): string | undefined {
  const normalized = optionalString(value);
  return normalizeCoverageTechnology(normalized?.split(",")[0]);
}

function isTechnologyFilteredLayer(layer: SituationLayerId): boolean {
  return layer === "mobile_coverage" || layer === "mobile_network";
}

function normalizeCoverageTechnology(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return normalized === "2G" || normalized === "4G" || normalized === "5G" ? normalized : undefined;
}

function situationFeatureCacheKey(query: SituationFeatureQuery): string {
  return [
    query.bbox.west.toFixed(4),
    query.bbox.south.toFixed(4),
    query.bbox.east.toFixed(4),
    query.bbox.north.toFixed(4),
    query.layers.join(","),
    query.limit,
    query.sources?.join(",") ?? "*",
    query.technology ?? "*"
  ].join("|");
}

function cacheTtlMsForLayers(layers: SituationLayerId[], config: SituationDataSourceConfig): number {
  return Math.min(...layers.map((layer) => layerCacheTtlMs(layer, config)));
}

function cacheTtlMsForSources(sources: string[] | undefined, config: SituationDataSourceConfig): number | undefined {
  if (!sources || sources.length === 0) {
    return undefined;
  }
  const ttlValues = sources
    .map((source) => config.sourceCacheTtlMs?.[source] ?? defaultConfig.sourceCacheTtlMs?.[source])
    .filter((ttl): ttl is number => typeof ttl === "number" && Number.isFinite(ttl));
  if (ttlValues.length !== sources.length) {
    return undefined;
  }
  return ttlValues.length > 0 ? Math.min(...ttlValues.map((ttl) => Math.max(1000, Math.trunc(ttl)))) : undefined;
}

function layerCacheTtlMs(layer: SituationLayerId, config: SituationDataSourceConfig): number {
  const configured = config.layerCacheTtlMs?.[layer];
  if (configured !== undefined && Number.isFinite(configured)) {
    return Math.max(1000, Math.trunc(configured));
  }
  return Math.max(1000, defaultConfig.layerCacheTtlMs?.[layer] ?? config.cacheTtlMs);
}

function cacheMaxEntries(config: SituationDataSourceConfig): number {
  return Math.max(1, Math.trunc(config.cacheMaxEntries ?? defaultConfig.cacheMaxEntries ?? 5000));
}

function staleIfErrorMs(config: SituationDataSourceConfig): number {
  return Math.max(0, Math.trunc(config.staleIfErrorMs ?? defaultConfig.staleIfErrorMs ?? 600000));
}

function gridSizeDegreesForBbox(bbox: SituationBbox): number {
  const width = Math.abs(bbox.east - bbox.west);
  const height = Math.abs(bbox.north - bbox.south);
  const maxDimension = Math.max(width, height);
  if (maxDimension >= 4) {
    return 0.5;
  }
  if (maxDimension >= 1.5) {
    return 0.25;
  }
  if (maxDimension >= 0.6) {
    return 0.1;
  }
  if (maxDimension >= 0.2) {
    return 0.05;
  }
  if (maxDimension >= 0.08) {
    return 0.02;
  }
  return 0.01;
}

function padBbox(bbox: SituationBbox, ratio: number): SituationBbox {
  const width = Math.max(0.001, Math.abs(bbox.east - bbox.west));
  const height = Math.max(0.001, Math.abs(bbox.north - bbox.south));
  return {
    east: clampNumber(bbox.east + width * ratio, -180, 180),
    north: clampNumber(bbox.north + height * ratio, -90, 90),
    south: clampNumber(bbox.south - height * ratio, -90, 90),
    west: clampNumber(bbox.west - width * ratio, -180, 180)
  };
}

function snapBboxToGrid(bbox: SituationBbox, gridSizeDegrees: number): SituationBbox {
  return {
    east: clampNumber(round(Math.ceil(bbox.east / gridSizeDegrees) * gridSizeDegrees, 4), -180, 180),
    north: clampNumber(round(Math.ceil(bbox.north / gridSizeDegrees) * gridSizeDegrees, 4), -90, 90),
    south: clampNumber(round(Math.floor(bbox.south / gridSizeDegrees) * gridSizeDegrees, 4), -90, 90),
    west: clampNumber(round(Math.floor(bbox.west / gridSizeDegrees) * gridSizeDegrees, 4), -180, 180)
  };
}

function isFeatureInBbox(feature: SituationFeature, bbox: SituationBbox): boolean {
  const featureBbox = geometryBbox(feature.geometry);
  return featureBbox ? bboxIntersects(featureBbox, bbox) : false;
}

function geometryBbox(geometry: SituationGeometry): SituationBbox | null {
  const coordinates = geometryCoordinates(geometry);
  if (coordinates.length === 0) {
    return null;
  }
  const lons = coordinates.map((coordinate) => coordinate[0]);
  const lats = coordinates.map((coordinate) => coordinate[1]);
  return {
    east: Math.max(...lons),
    north: Math.max(...lats),
    south: Math.min(...lats),
    west: Math.min(...lons)
  };
}

function geometryCoordinates(geometry: SituationGeometry): Array<[number, number]> {
  if (geometry.type === "Point") {
    return [geometry.coordinates];
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates;
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.flatMap((line) => line);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) => polygon.flatMap((ring) => ring));
  }
  return geometry.coordinates.flatMap((ring) => ring);
}

function bboxIntersects(a: SituationBbox, b: SituationBbox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function uniqueLayers(layers: SituationLayerId[]): SituationLayerId[] {
  return allowedLayerIds.filter((layer) => layers.includes(layer));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function mergeStringLists(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  const merged = uniqueStrings([...(a ?? []), ...(b ?? [])]);
  return merged.length > 0 ? merged : undefined;
}

function minOptionalNumber(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return Math.min(a, b);
}

function situationLayerLabelFromCatalog(layerId: SituationLayerId, label: string): string {
  if (layerId === "mobile" && label.toLowerCase().includes("komunika")) {
    return "BTS / komunikační stožáry";
  }
  return label;
}

function isSituationLayerId(value: unknown): value is SituationLayerId {
  return typeof value === "string" && allowedLayerIds.includes(value as SituationLayerId);
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(clampNumber(parsed, min, max));
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalFinite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampNumber(parsed, 0, 1) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.flatMap((item) => {
    const normalized = optionalString(item);
    return normalized ? [normalized] : [];
  });
  return items.length > 0 ? items : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
