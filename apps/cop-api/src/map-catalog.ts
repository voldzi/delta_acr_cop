import type { SafetyDataSourceId, SafetyLayerDescriptor, SafetySourceDescriptor } from "./safety-data-source.js";
import type { SituationLayerDescriptor, SituationSourceDescriptor } from "./situation-data-source.js";
import type { TakGatewayLayerDescriptor, TakGatewaySourceDescriptor } from "./tak-gateway-source.js";
import type { MissionArenaLayerDescriptor, MissionArenaSourceDescriptor } from "./mission-arena-source.js";
import type { ProviderCatalogLayer, ProviderCatalogSource, ProviderMapCatalog } from "./provider-map-catalog.js";

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

export interface BuildMapCatalogInput {
  generatedAt: Date;
  includeDiagnostics?: boolean;
  includePartner?: boolean;
  locale?: string;
  flight?: {
    catalog?: ProviderMapCatalog;
    status?: MapCatalogProvider["status"];
    warning?: string;
  };
  missionArena?: {
    layers: MissionArenaLayerDescriptor[];
    sources: MissionArenaSourceDescriptor[];
    status?: MapCatalogProvider["status"];
    warning?: string;
  };
  safety?: {
    catalog?: ProviderMapCatalog;
    layers: SafetyLayerDescriptor[];
    sources: SafetySourceDescriptor[];
    status?: MapCatalogProvider["status"];
    warning?: string;
  };
  situation?: {
    catalog?: ProviderMapCatalog;
    layers: SituationLayerDescriptor[];
    sources: SituationSourceDescriptor[];
    status?: MapCatalogProvider["status"];
    warning?: string;
  };
  tak?: {
    catalog?: ProviderMapCatalog;
    layers: TakGatewayLayerDescriptor[];
    sources: TakGatewaySourceDescriptor[];
    status?: MapCatalogProvider["status"];
    warning?: string;
  };
}

export function buildMapCatalog(input: BuildMapCatalogInput): MapCatalogResponse {
  const includeDiagnostics = input.includeDiagnostics === true;
  const includePartner = input.includePartner === true;
  const providers = buildProviders(input);
  const situationCompatibilitySources = input.situation?.catalog
    ? buildSituationCatalogCompatibilitySources(input.situation.catalog, input.situation.sources ?? [])
    : [];
  const situationCompatibilityLayers = input.situation?.catalog
    ? buildSituationCatalogCompatibilityLayers(input.situation.catalog, input.situation.sources ?? [])
    : [];
  const rawSources = [
    ...buildCopSources(),
    ...(input.safety?.catalog ? buildProviderCatalogSources(input.safety.catalog, includeDiagnostics, includePartner) : buildSafetySources(input.safety?.sources ?? [])),
    ...(input.situation?.catalog
      ? [...buildProviderCatalogSources(input.situation.catalog, includeDiagnostics, includePartner), ...situationCompatibilitySources]
      : buildSituationSources(input.situation?.sources ?? [])),
    ...(input.flight?.catalog ? buildProviderCatalogSources(input.flight.catalog, includeDiagnostics, includePartner) : []),
    ...buildMissionArenaSources(input.missionArena?.sources ?? []),
    ...(includePartner ? (input.tak?.catalog ? buildProviderCatalogSources(input.tak.catalog, includeDiagnostics, includePartner) : buildTakSources(input.tak?.sources ?? [])) : [])
  ];
  const rawLayers = [
    ...(input.safety?.catalog ? buildProviderCatalogLayers(input.safety.catalog, includeDiagnostics, includePartner) : buildSafetyLayers(input.safety?.layers ?? [], input.safety?.sources ?? [])),
    ...(input.situation?.catalog
      ? [...buildProviderCatalogLayers(input.situation.catalog, includeDiagnostics, includePartner), ...situationCompatibilityLayers]
      : buildSituationLayers(input.situation?.layers ?? [], input.situation?.sources ?? [])),
    ...buildCopOwnedLayers(),
    ...(input.flight?.catalog ? buildProviderCatalogLayers(input.flight.catalog, includeDiagnostics, includePartner) : []),
    ...buildMissionArenaLayers(input.missionArena?.layers ?? [], input.missionArena?.sources ?? []),
    ...(includePartner ? (input.tak?.catalog ? buildProviderCatalogLayers(input.tak.catalog, includeDiagnostics, includePartner) : buildTakLayers(input.tak?.layers ?? [], input.tak?.sources ?? [])) : []),
    ...(includeDiagnostics ? buildDiagnosticLayers(input.situation?.layers ?? [], input.situation?.sources ?? []) : [])
  ];
  const layers = dedupeLayers(filterCompatibilityLayers(rawLayers, providers));
  const sources = dedupeSources(filterCompatibilitySources(rawSources, layers, providers));
  const warnings = [input.flight?.warning, input.missionArena?.warning, input.safety?.warning, input.situation?.warning, input.tak?.warning].filter((warning): warning is string => Boolean(warning));

  return {
    catalogVersion: "map-catalog-v1",
    generatedAt: input.generatedAt.toISOString(),
    groups: defaultGroups(includeDiagnostics, includePartner),
    layers,
    locale: input.locale ?? "cs-CZ",
    providers,
    sources,
    warnings
  };
}

function buildProviders(input: BuildMapCatalogInput): MapCatalogProvider[] {
  return [
    {
      label: "SIM safety data",
      providerId: "sim.safety-data",
      status: input.safety?.status ?? "disabled"
    },
    {
      label: "SIM situation data",
      providerId: "sim.situation-data",
      status: input.situation?.status ?? "disabled"
    },
    {
      label: "SIM flight data",
      providerId: "sim.flight-data",
      status: input.flight?.status ?? "disabled"
    },
    {
      label: "COP community and user data",
      providerId: "cop.community",
      status: "online"
    },
    {
      label: "COP user profile data",
      providerId: "cop.user-profile",
      status: "online"
    },
    {
      label: "COP user sketches",
      providerId: "cop.sketch",
      status: "online"
    },
    {
      label: "COP track stream",
      providerId: "cop.tracks",
      status: "online"
    },
    {
      label: "Mission Arena",
      providerId: "csm.mission-arena",
      status: input.missionArena?.status ?? "disabled"
    },
    ...(input.includePartner === true
      ? [
          {
            label: "SIM TAK Gateway",
            providerId: "sim.tak-gateway",
            status: input.tak?.status ?? "disabled"
          }
        ]
      : [])
  ];
}

function defaultGroups(includeDiagnostics: boolean, includePartner: boolean): MapCatalogGroup[] {
  return [
    { groupId: "risks", icon: "alert-triangle", label: "Rizika a výstrahy", order: 10 },
    { groupId: "risks.weather", icon: "cloud-sun", label: "Počasí", order: 20, parentGroupId: "risks" },
    { groupId: "communications", icon: "radio-tower", label: "Komunikace", order: 30 },
    { groupId: "transport", icon: "bus", label: "Doprava", order: 35 },
    { groupId: "infrastructure", icon: "building-2", label: "Infrastruktura", order: 40 },
    { groupId: "boundary", icon: "map", label: "Hranice a území", order: 45 },
    { groupId: "flight", icon: "plane", label: "Letecký provoz", order: 50 },
    { groupId: "user", icon: "map-pin", label: "Moje data", order: 60 },
    { groupId: "presentation", icon: "sparkles", label: "Prezentace a eventy", order: 65 },
    ...(includePartner ? [{ groupId: "partner", icon: "shield-check", label: "Partnerské vrstvy", order: 70 }] : []),
    ...(includeDiagnostics ? [{ groupId: "diagnostic", icon: "database", label: "Diagnostika", order: 90 }] : [])
  ];
}

function buildProviderCatalogLayers(catalog: ProviderMapCatalog, includeDiagnostics: boolean, includePartner: boolean): MapCatalogLayer[] {
  return catalog.layers
    .filter((layer) => shouldIncludeCatalogAudience(layer.audience, includeDiagnostics, includePartner))
    .flatMap((layer) => providerCatalogLayerToMapLayer(catalog.providerId, layer));
}

function providerCatalogLayerToMapLayer(providerId: string, layer: ProviderCatalogLayer): MapCatalogLayer[] {
  const providerLayerIds = layer.query?.providerLayerIds?.filter(Boolean) ?? [];
  const rawProviderSourceIds = layer.query?.providerSourceIds?.filter(Boolean) ?? layer.sourceIds?.filter(Boolean) ?? [];
  const providerSourceIds = sanitizeProviderCatalogLayerSourceIds(providerId, layer.recommendedCatalogLayerId, rawProviderSourceIds);
  const variants = layer.recommendedCatalogLayerId === "public.traffic.transit" && providerSourceIds.some(isPublicTransitStaticSourceId)
    ? [
        { layerId: "public.traffic.transit", sourceIds: providerSourceIds.filter((sourceId) => !isPublicTransitStaticSourceId(sourceId)) },
        { layerId: "public.traffic.transit_stops", sourceIds: providerSourceIds.filter(isPublicTransitStaticSourceId) }
      ].filter((variant) => variant.sourceIds.length > 0)
    : [{ layerId: layer.recommendedCatalogLayerId, sourceIds: providerSourceIds }];
  return variants.map((variant) => providerCatalogLayerVariantToMapLayer(providerId, layer, providerLayerIds, variant.layerId, variant.sourceIds));
}

function providerCatalogLayerVariantToMapLayer(
  providerId: string,
  layer: ProviderCatalogLayer,
  providerLayerIds: string[],
  catalogLayerId: string,
  providerSourceIds: string[]
): MapCatalogLayer {
  const variantLayer: ProviderCatalogLayer = {
    ...layer,
    recommendedCatalogLayerId: catalogLayerId,
    query: {
      ...layer.query,
      maxFeatures: catalogLayerId === "public.traffic.transit_stops" ? 5000 : layer.query?.maxFeatures,
      providerSourceIds
    },
    sourceIds: providerSourceIds,
    styleProfile: catalogLayerId === "public.traffic.transit_stops" ? "traffic-public-transit-stops-v1" : layer.styleProfile
  };
  const mode = normalizeQueryMode(layer.query?.mode);
  const role = roleForCatalogLayer(variantLayer);
  const audience = normalizeAudience(layer.audience);
  const kind = normalizeLayerKind(layer.kind);
  const enabled = providerCatalogLayerEnabled(layer);
  const provenanceSourceIds = sanitizeProviderCatalogLayerSourceIds(
    providerId,
    catalogLayerId,
    variantLayer.sourceIds?.filter(Boolean) ?? providerSourceIds
  );
  const categoryIds = uniqueStrings([
    ...(layer.query?.categoryIds ?? []),
    ...(layer.query?.categoryFilter ?? [])
  ]);
  return {
    audience,
    ...(layer.availability ? { availability: layer.availability } : {}),
    cacheTtlSeconds: layer.cacheTtlSeconds,
    ...(layer.compatibilityOnly === true ? { compatibilityOnly: true } : {}),
    defaultVisible: enabled && defaultVisibleForCatalogLayer(variantLayer),
    description: descriptionForCatalogLayer(variantLayer),
    ...(layer.disabledReason ? { disabledReason: layer.disabledReason } : {}),
    enabled,
    filters: normalizeProviderFilters(layer.filters),
    geometryTypes: geometryTypesForCatalogLayer(variantLayer),
    groupId: groupIdForCatalogLayer(variantLayer),
    kind,
    label: labelForCatalogLayer(variantLayer),
    layerId: catalogLayerId,
    legal: layer.legal,
    maxZoom: layer.maxZoom,
    minZoom: minZoomForCatalogLayer(variantLayer),
    preferredProviderId: layer.preferredProviderId,
    provenance: {
      sourceIds: uniqueStrings(provenanceSourceIds.map((sourceId) => `${providerId}:${sourceId}`)),
      ...(layer.technicalInputs && layer.technicalInputs.length > 0 ? { technicalInputs: layer.technicalInputs.map((sourceId) => `${providerId}:${sourceId}`) } : {})
    },
    query: {
      ...(categoryIds.length > 0 ? { categoryIds } : {}),
      maxFeatures: maxFeaturesForCatalogLayer(variantLayer),
      mode,
      providerId: layer.query?.providerId ?? providerId,
      ...(providerLayerIds.length > 0 ? { providerLayerIds } : {}),
      ...(providerSourceIds.length > 0 ? { providerSourceIds } : {}),
      streamId: streamIdForCatalogLayer(layer.query?.streamId)
    },
    refreshSeconds: layer.refreshSeconds,
    role,
    selectable: enabled && selectableForCatalogLayer(variantLayer),
    styleProfile: variantLayer.styleProfile ?? styleProfileForCatalogLayer(variantLayer)
  };
}

function providerCatalogLayerEnabled(layer: ProviderCatalogLayer): boolean {
  return layer.enabled !== false && layer.availability !== "disabled";
}

function sanitizeProviderCatalogLayerSourceIds(providerId: string, layerId: string, sourceIds: string[]): string[] {
  if (providerId !== "sim.safety-data" || layerId !== "public.safety.warnings") {
    return uniqueStrings(sourceIds);
  }
  return uniqueStrings(sourceIds.filter((sourceId) => sourceId !== "chmi_alerts" && sourceId !== "weather_alerts"));
}

function maxFeaturesForCatalogLayer(layer: ProviderCatalogLayer): number | undefined {
  if (layer.recommendedCatalogLayerId === "public.safety.flood") {
    return Math.max(layer.query?.maxFeatures ?? 0, 600);
  }
  if (layer.recommendedCatalogLayerId === "public.traffic.transit_stops") {
    return Math.max(layer.query?.maxFeatures ?? 0, 5000);
  }
  if (layer.recommendedCatalogLayerId === "public.traffic.transit") {
    return Math.max(layer.query?.maxFeatures ?? 0, 5000);
  }
  return layer.query?.maxFeatures;
}

function defaultVisibleForCatalogLayer(layer: ProviderCatalogLayer): boolean {
  if (layer.recommendedCatalogLayerId === "public.weather.observations") {
    return true;
  }
  if (layer.recommendedCatalogLayerId === "public.weather.current") {
    return false;
  }
  return layer.defaultVisible === true;
}

function roleForCatalogLayer(layer: ProviderCatalogLayer): MapCatalogLayerRole {
  if (layer.recommendedCatalogLayerId === "public.weather.observations") {
    return "primary";
  }
  if (layer.recommendedCatalogLayerId === "public.weather.current") {
    return "reference";
  }
  return normalizeLayerRole(layer.role);
}

function geometryTypesForCatalogLayer(layer: ProviderCatalogLayer): string[] | undefined {
  const geometryTypes = nonEmpty(layer.geometryTypes) ?? [];
  if (layer.recommendedCatalogLayerId === "public.safety.fire" || layer.recommendedCatalogLayerId === "public.safety.weather_alerts") {
    return uniqueStrings([...geometryTypes, "Polygon", "MultiPolygon"]);
  }
  if (layer.recommendedCatalogLayerId === "public.boundary.admin"
    || layer.recommendedCatalogLayerId.startsWith("public.boundary.")
    || layer.recommendedCatalogLayerId === "public.place.settlements") {
    return uniqueStrings([...geometryTypes, "Polygon", "MultiPolygon"]);
  }
  return geometryTypes.length > 0 ? geometryTypes : undefined;
}

function minZoomForCatalogLayer(layer: ProviderCatalogLayer): number | undefined {
  const layerId = layer.recommendedCatalogLayerId;
  if (
    layerId === "public.mobile.network"
    || layerId === "reference.infrastructure.communications"
    || layerId === "public.weather.webcams"
    || layerId === "public.weather.observations"
    || layerId === "public.weather.temperature_grid"
    || layerId === "public.weather.wind_field"
    || layerId === "public.weather.precipitation_grid"
    || layerId === "public.weather.humidity_grid"
    || layerId === "public.weather.pressure_grid"
    || layerId === "public.safety.flood"
  ) {
    return Math.min(layer.minZoom ?? 4, 4);
  }
  if (layerId === "public.traffic.transit") {
    return Math.min(layer.minZoom ?? 7, 7);
  }
  if (layerId === "public.traffic.transit_stops") {
    return Math.max(layer.minZoom ?? 11, 11);
  }
  return layer.minZoom;
}

function buildProviderCatalogSources(catalog: ProviderMapCatalog, includeDiagnostics: boolean, includePartner: boolean): MapCatalogSource[] {
  return catalog.sources
    .filter((source) => shouldIncludeCatalogAudience(source.audience, includeDiagnostics, includePartner))
    .flatMap((source) => providerCatalogSourceToMapSource(catalog.providerId, source));
}

function providerCatalogSourceToMapSource(providerId: string, source: ProviderCatalogSource): MapCatalogSource[] {
  const feedsCatalogLayerIds = sanitizeProviderCatalogSourceFeedLayerIds(
    providerId,
    source.sourceId,
    nonEmpty(source.feedsCatalogLayerIds) ?? nonEmpty(source.feedsLayerIds)
  );
  const enabled = source.enabled === true && source.availability !== "disabled";
  return [
    {
      audience: normalizeAudience(source.audience),
      ...(source.availability ? { availability: source.availability } : {}),
      cacheTtlSeconds: source.cacheTtlSeconds,
      ...(source.compatibilityOnly === true || (normalizeSourceRole(source.sourceRole) === "projection" && Boolean(source.preferredProviderId)) ? { compatibilityOnly: true } : {}),
      ...(source.disabledReason ? { disabledReason: source.disabledReason } : {}),
      enabled,
      feedsCatalogLayerIds,
      label: source.label ?? source.sourceId,
      preferredProviderId: source.preferredProviderId,
      providerId,
      selectableInMap: enabled && source.selectableInMap === true,
      sourceId: source.sourceId,
      sourceRole: normalizeSourceRole(source.sourceRole),
      updateCadenceSeconds: source.updateCadenceSeconds,
      usedByCatalogLayerIds: nonEmpty(providerId === "sim.situation-data" && isPublicTransitStaticSourceId(source.sourceId) ? ["public.traffic.transit_stops"] : source.usedByCatalogLayerIds),
      visibleInDiagnostics: source.visibleInDiagnostics === true || normalizeAudience(source.audience) === "diagnostic"
    }
  ];
}

function sanitizeProviderCatalogSourceFeedLayerIds(providerId: string, sourceId: string, layerIds: string[] | undefined): string[] | undefined {
  if (providerId === "sim.situation-data" && isPublicTransitStaticSourceId(sourceId)) {
    return ["public.traffic.transit_stops"];
  }
  if (providerId !== "sim.safety-data") {
    return layerIds;
  }
  if (sourceId === "chmi_alerts") {
    return ["public.safety.weather_alerts", "public.safety.fire"];
  }
  return layerIds;
}

function normalizeProviderFilters(filters: ProviderCatalogLayer["filters"]): MapCatalogFilter[] | undefined {
  const normalized = (filters ?? []).flatMap((filter): MapCatalogFilter[] => {
    const type = filter.type === "select" || filter.type === "toggle" || filter.type === "multi_select" ? filter.type : undefined;
    if (!type) {
      return [];
    }
    return [
      {
        defaultValue: filter.defaultValue,
        filterId: filter.filterId,
        label: filter.label,
        type,
        values: nonEmpty(filter.values)
      }
    ];
  });
  return normalized.length > 0 ? normalized : undefined;
}

function shouldIncludeCatalogAudience(value: string | undefined, includeDiagnostics: boolean, includePartner: boolean): boolean {
  const audience = normalizeAudience(value);
  if (audience === "diagnostic" || audience === "admin") {
    return includeDiagnostics;
  }
  if (audience === "partner") {
    return includePartner;
  }
  return true;
}

const curatedCatalogLayerLabels: Record<string, string> = {
  "public.traffic.transit": "Veřejná doprava",
  "public.traffic.transit_stops": "Zastávky veřejné dopravy",
  "public.safety.air_quality": "Kvalita ovzduší",
  "public.safety.flood": "Vodní stavy a průtoky",
  "public.weather.current": "Počasí ve středu mapy",
  "public.weather.forecast_area": "Předpověď počasí",
  "public.weather.observations": "Počasí",
  "public.weather.temperature_grid": "Teplota",
  "public.weather.wind_field": "Vítr",
  "public.weather.precipitation_grid": "Srážky",
  "public.weather.humidity_grid": "Vlhkost",
  "public.weather.pressure_grid": "Tlak",
  "public.weather.webcams": "Kamery",
  "public.weather.radar_precipitation": "Radar srážek"
};

const curatedCatalogLayerDescriptions: Record<string, string> = {
  "public.traffic.transit": "Živá poloha vozidel veřejné dopravy ze SIM.",
  "public.traffic.transit_stops": "Statické zastávky veřejné dopravy ze SIM katalogu.",
  "public.safety.flood": "Hydrologické stanice, vodní stavy, průtoky a stupně povodňové aktivity."
};

const basicUiHiddenWeatherLayerIds = new Set([
  "public.safety.air_quality_grid",
  "public.safety.thunderstorm_risk",
  "public.weather.current",
  "public.weather.aviation",
  "public.weather.radar_nowcast",
  "public.weather.radar_reflectivity"
]);

function selectableForCatalogLayer(layer: ProviderCatalogLayer): boolean {
  if (layer.recommendedCatalogLayerId === "reference.infrastructure.communications") {
    return true;
  }
  if (basicUiHiddenWeatherLayerIds.has(layer.recommendedCatalogLayerId)) {
    return false;
  }
  return layer.selectable === true;
}

function labelForCatalogLayer(layer: ProviderCatalogLayer): string {
  const curatedLabel = curatedCatalogLayerLabels[layer.recommendedCatalogLayerId];
  if (curatedLabel) {
    return curatedLabel;
  }
  if (layer.recommendedCatalogLayerId === "reference.infrastructure.communications") {
    return "BTS / komunikační stožáry";
  }
  if (layer.recommendedCatalogLayerId === "flight.public.tracks") {
    return "Veřejné lety";
  }
  return layer.label;
}

function descriptionForCatalogLayer(layer: ProviderCatalogLayer): string | undefined {
  return curatedCatalogLayerDescriptions[layer.recommendedCatalogLayerId] ?? layer.description;
}

function groupIdForCatalogLayer(layer: ProviderCatalogLayer): string {
  const layerId = layer.recommendedCatalogLayerId;
  if (layerId === "public.safety.air_quality") {
    return "risks.weather";
  }
  if (layerId.startsWith("public.safety.")) {
    return "risks";
  }
  if (layerId.startsWith("public.boundary.")) {
    return "boundary";
  }
  if (layerId.startsWith("public.place.")) {
    return "boundary";
  }
  if (layerId.startsWith("public.weather.")) {
    return "risks.weather";
  }
  if (layerId.startsWith("public.traffic.")) {
    return "transport";
  }
  if (layerId.startsWith("public.mobile.") || layerId === "reference.infrastructure.communications") {
    return "communications";
  }
  if (layerId.startsWith("reference.infrastructure.")) {
    return "infrastructure";
  }
  if (layerId.startsWith("flight.")) {
    return "flight";
  }
  if (layerId.startsWith("user.")) {
    return "user";
  }
  if (layerId.startsWith("partner.")) {
    return "partner";
  }
  if (layerId.startsWith("diagnostic.")) {
    return "diagnostic";
  }
  const firstCategory = layer.categoryPath?.[0];
  if (firstCategory === "weather") {
    return "risks.weather";
  }
  if (firstCategory === "safety") {
    return "risks";
  }
  if (firstCategory === "boundary") {
    return "boundary";
  }
  if (firstCategory === "traffic" || firstCategory === "transport") {
    return "transport";
  }
  if (firstCategory === "communications") {
    return "communications";
  }
  if (firstCategory === "reference") {
    return "infrastructure";
  }
  return "infrastructure";
}

function normalizeQueryMode(value: string | undefined): MapCatalogQuery["mode"] {
  return value === "grid" || value === "internal" || value === "stream" || value === "tile" || value === "bbox" ? value : "bbox";
}

function normalizeLayerRole(value: string | undefined): MapCatalogLayerRole {
  return value === "diagnostic" || value === "overlay" || value === "partner" || value === "primary" || value === "reference" || value === "user" ? value : "reference";
}

function normalizeAudience(value: string | undefined): MapCatalogAudience {
  return value === "admin" || value === "authenticated" || value === "diagnostic" || value === "partner" || value === "public" ? value : "public";
}

function normalizeLayerKind(value: string | undefined): MapCatalogLayerKind {
  return value === "aggregate" || value === "grid_field" || value === "mvt_tiles" || value === "raster_overlay" || value === "raster_tiles" || value === "static_reference" || value === "track_stream" || value === "user_objects" || value === "vector_features" || value === "vector_field"
    ? value
    : "vector_features";
}

function normalizeSourceRole(value: string | undefined): MapCatalogSourceRole {
  return value === "aggregate" || value === "diagnostic" || value === "final" || value === "input" || value === "mock" || value === "projection" || value === "reference" ? value : "reference";
}

function streamIdForCatalogLayer(value: string | undefined): string {
  return value === "cop.features" ? "features" : (value ?? "features");
}

function styleProfileForCatalogLayer(layer: ProviderCatalogLayer): string {
  if (layer.recommendedCatalogLayerId === "reference.infrastructure.communications") {
    return "infrastructure-communications-v1";
  }
  return `${layer.recommendedCatalogLayerId.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-v1`;
}

function buildSafetyLayers(layers: SafetyLayerDescriptor[], sources: SafetySourceDescriptor[]): MapCatalogLayer[] {
  const boundaryLayer = findLayer(layers, "boundary_admin");
  const warningLayer = findLayer(layers, "warnings");
  const floodLayer = findLayer(layers, "flood");
  const fireLayer = findLayer(layers, "fire");
  const weatherAlertsLayer = findLayer(layers, "weather_alerts");
  return [
    {
      audience: "public",
      cacheTtlSeconds: 120,
      defaultVisible: warningLayer?.defaultVisible ?? true,
      description: warningLayer?.description ?? "Krizové výstrahy a rizikové události ze safety zdrojů.",
      geometryTypes: warningLayer?.geometryTypes ?? ["Point", "Polygon"],
      groupId: "risks",
      kind: "vector_features",
      label: "Krizové výstrahy",
      layerId: "public.safety.warnings",
      legal: legalFromSource(findSource(sources, "gdacs_alerts") ?? findSource(sources, "hzs_incidents") ?? findSource(sources, "road_srti_lod")),
      maxZoom: 18,
      minZoom: 5,
      provenance: {
        sourceIds: ["sim.safety-data:gdacs_alerts", "sim.safety-data:hzs_incidents", "sim.safety-data:road_srti_lod"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "sim.safety-data",
        providerLayerIds: ["warnings"],
        providerSourceIds: ["gdacs_alerts", "hzs_incidents", "road_srti_lod"],
        streamId: "features"
      },
      refreshSeconds: warningLayer?.expectedCadenceSeconds ?? 300,
      role: "primary",
      selectable: true,
      styleProfile: "public-warning-v1"
    },
    {
      audience: "public",
      cacheTtlSeconds: 300,
      defaultVisible: floodLayer?.defaultVisible ?? true,
      description: floodLayer?.description ?? "Hydrologické stanice, vodní stavy, průtoky a stupně povodňové aktivity.",
      geometryTypes: floodLayer?.geometryTypes ?? ["Point"],
      groupId: "risks",
      kind: "vector_features",
      label: "Vodní stavy a průtoky",
      layerId: "public.safety.flood",
      legal: legalFromSource(findSource(sources, "chmi_hydro") ?? findSource(sources, "gdacs_alerts")),
      maxZoom: 18,
      minZoom: 4,
      provenance: {
        sourceIds: ["sim.safety-data:chmi_hydro", "sim.safety-data:gdacs_alerts"]
      },
      query: {
        maxFeatures: 600,
        mode: "bbox",
        providerId: "sim.safety-data",
        providerLayerIds: ["flood"],
        providerSourceIds: ["chmi_hydro", "gdacs_alerts"],
        streamId: "features"
      },
      refreshSeconds: floodLayer?.expectedCadenceSeconds ?? 600,
      role: "primary",
      selectable: true,
      styleProfile: "water-level-v1"
    },
    {
      audience: "public",
      cacheTtlSeconds: 600,
      defaultVisible: fireLayer?.defaultVisible ?? false,
      description: fireLayer?.description ?? "Požární nebezpečí, hotspoty a dostupné ověřené požární incidenty.",
      geometryTypes: fireLayer?.geometryTypes ?? ["Point", "Polygon", "MultiPolygon"],
      groupId: "risks",
      kind: "vector_features",
      label: "Požáry",
      layerId: "public.safety.fire",
      legal: legalFromSource(findSource(sources, "chmi_alerts") ?? findSource(sources, "gdacs_alerts") ?? findSource(sources, "hzs_incidents") ?? findSource(sources, "nasa_firms") ?? findSource(sources, "fire_hotspots") ?? findSource(sources, "fire_incidents")),
      maxZoom: 18,
      minZoom: 5,
      provenance: {
        sourceIds: ["sim.safety-data:chmi_alerts", "sim.safety-data:gdacs_alerts", "sim.safety-data:hzs_incidents", "sim.safety-data:nasa_firms", "sim.safety-data:fire_hotspots", "sim.safety-data:fire_incidents"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "sim.safety-data",
        providerLayerIds: ["fire"],
        providerSourceIds: ["chmi_alerts", "gdacs_alerts", "hzs_incidents", "nasa_firms", "fire_hotspots", "fire_incidents"],
        streamId: "features"
      },
      refreshSeconds: fireLayer?.expectedCadenceSeconds ?? 600,
      role: "primary",
      selectable: true,
      styleProfile: "fire-risk-v1"
    },
    {
      audience: "public",
      cacheTtlSeconds: 300,
      defaultVisible: weatherAlertsLayer?.defaultVisible ?? false,
      description: weatherAlertsLayer?.description ?? "Meteorologické výstrahy podle území, typu nebezpečí a platnosti.",
      geometryTypes: weatherAlertsLayer?.geometryTypes ?? ["Polygon", "MultiPolygon"],
      groupId: "risks.weather",
      kind: "vector_features",
      label: "Meteorologické výstrahy",
      layerId: "public.safety.weather_alerts",
      legal: legalFromSource(findSource(sources, "weather_alerts") ?? findSource(sources, "chmi_alerts")),
      maxZoom: 18,
      minZoom: 5,
      provenance: {
        sourceIds: ["sim.safety-data:chmi_alerts", "sim.safety-data:weather_alerts"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "sim.safety-data",
        providerLayerIds: ["weather_alerts"],
        providerSourceIds: ["chmi_alerts", "weather_alerts"],
        streamId: "features"
      },
      refreshSeconds: weatherAlertsLayer?.expectedCadenceSeconds ?? 300,
      role: "primary",
      selectable: true,
      styleProfile: "weather-alert-area-v1"
    },
    {
      audience: "public",
      cacheTtlSeconds: 86400,
      defaultVisible: boundaryLayer?.defaultVisible ?? false,
      description: boundaryLayer?.description ?? "Referenční hranice státu a správních území pro orientaci v mapě.",
      geometryTypes: boundaryLayer?.geometryTypes ?? ["Polygon", "MultiPolygon"],
      groupId: "boundary",
      kind: "vector_features",
      label: "Správní hranice",
      layerId: "public.boundary.admin",
      legal: legalFromSource(findSource(sources, "admin_boundaries")),
      maxZoom: 18,
      minZoom: 4,
      provenance: {
        sourceIds: ["sim.safety-data:admin_boundaries"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "sim.safety-data",
        providerLayerIds: ["boundary_admin"],
        providerSourceIds: ["admin_boundaries"],
        streamId: "features"
      },
      refreshSeconds: boundaryLayer?.expectedCadenceSeconds ?? 86400,
      role: "reference",
      selectable: true,
      styleProfile: "boundary-admin-v1"
    }
  ];
}

function buildSituationLayers(layers: SituationLayerDescriptor[], sources: SituationSourceDescriptor[]): MapCatalogLayer[] {
  const weatherLayer = findLayer(layers, "weather");
  const trafficLayer = findLayer(layers, "traffic");
  const mobileLayer = findLayer(layers, "mobile_network");
  const groundLayer = findLayer(layers, "ground");
  return [
    {
      audience: "public",
      cacheTtlSeconds: 300,
      defaultVisible: false,
      description: "Referenční bodový souhrn pro střed mapy. Pro běžné počasí v mapě používejte měřené stanice ČHMÚ.",
      geometryTypes: weatherLayer?.geometryTypes ?? ["Point"],
      groupId: "risks.weather",
      kind: "vector_features",
      label: "Počasí ve středu mapy",
      layerId: "public.weather.current",
      legal: legalFromSource(findSource(sources, "open_meteo")),
      maxZoom: 18,
      minZoom: 5,
      provenance: {
        sourceIds: ["sim.situation-data:open_meteo"]
      },
      query: {
        maxFeatures: 50,
        mode: "bbox",
        providerId: "sim.situation-data",
        providerLayerIds: ["weather"],
        providerSourceIds: ["open_meteo"],
        streamId: "features"
      },
      refreshSeconds: findSource(sources, "open_meteo")?.updateCadenceSeconds ?? weatherLayer?.expectedCadenceSeconds ?? 600,
      role: "reference",
      selectable: false,
      styleProfile: "weather-current-v1"
    },
    {
      audience: "public",
      cacheTtlSeconds: 300,
      defaultVisible: false,
      description: "Letištní počasí METAR/TAF jako referenční kontext.",
      geometryTypes: ["Point"],
      groupId: "risks.weather",
      kind: "vector_features",
      label: "Letištní počasí",
      layerId: "public.weather.aviation",
      legal: legalFromSource(findSource(sources, "aviation_weather")),
      maxZoom: 18,
      minZoom: 7,
      provenance: {
        sourceIds: ["sim.situation-data:aviation_weather"]
      },
      query: {
        categoryIds: ["aviation_weather_station"],
        maxFeatures: 50,
        mode: "bbox",
        providerId: "sim.situation-data",
        providerLayerIds: ["weather"],
        providerSourceIds: ["aviation_weather"],
        streamId: "features"
      },
      refreshSeconds: findSource(sources, "aviation_weather")?.updateCadenceSeconds ?? 600,
      role: "reference",
      selectable: true,
      styleProfile: "aviation-weather-v1"
    },
    {
      audience: "public",
      cacheTtlSeconds: 600,
      defaultVisible: true,
      description: "Měřené počasí ze stanic ČHMÚ: teplota, vítr, srážky, vlhkost, tlak a odvozený stav počasí.",
      geometryTypes: ["Point"],
      groupId: "risks.weather",
      kind: "vector_features",
      label: "Počasí",
      layerId: "public.weather.observations",
      legal: legalFromSource(findSource(sources, "chmi_weather_stations")),
      maxZoom: 18,
      minZoom: 4,
      provenance: {
        sourceIds: ["sim.situation-data:chmi_weather_stations"]
      },
      query: {
        maxFeatures: 150,
        mode: "bbox",
        providerId: "sim.situation-data",
        providerLayerIds: ["weather"],
        providerSourceIds: ["chmi_weather_stations"],
        streamId: "features"
      },
      refreshSeconds: findSource(sources, "chmi_weather_stations")?.updateCadenceSeconds ?? 600,
      role: "primary",
      selectable: true,
      styleProfile: "weather-observations-v1"
    },
    buildWeatherForecastAreaCatalogLayer(sources),
    buildWeatherWebcamCatalogLayer(sources),
    {
      audience: "public",
      cacheTtlSeconds: 900,
      defaultVisible: false,
      description: "Měřená kvalita ovzduší ČHMÚ, včetně indexu kvality a dominantní znečišťující látky.",
      geometryTypes: ["Point"],
      groupId: "risks.weather",
      kind: "vector_features",
      label: "Kvalita ovzduší",
      layerId: "public.safety.air_quality",
      legal: legalFromSource(findSource(sources, "chmi_air_quality")),
      maxZoom: 18,
      minZoom: 5,
      provenance: {
        sourceIds: ["sim.situation-data:chmi_air_quality"]
      },
      query: {
        maxFeatures: 150,
        mode: "bbox",
        providerId: "sim.situation-data",
        providerLayerIds: ["air_quality"],
        providerSourceIds: ["chmi_air_quality"],
        streamId: "features"
      },
      refreshSeconds: findSource(sources, "chmi_air_quality")?.updateCadenceSeconds ?? 900,
      role: "overlay",
      selectable: true,
      styleProfile: "air-quality-observations-v1"
    },
    {
      audience: "public",
      cacheTtlSeconds: 600,
      defaultVisible: mobileLayer?.defaultVisible ?? false,
      description: mobileLayer?.description ?? "Sjednocené občanské hodnocení dostupnosti mobilní sítě.",
      filters: [
        {
          defaultValue: ["4G"],
          filterId: "technology",
          label: "Technologie",
          type: "multi_select",
          values: ["2G", "4G", "5G"]
        }
      ],
      geometryTypes: mobileLayer?.geometryTypes ?? ["Polygon"],
      groupId: "communications",
      kind: "vector_features",
      label: "Mobilní síť",
      layerId: "public.mobile.network",
      legal: legalFromSource(findSource(sources, "mobile_network_model"), ["Modelový odhad, ne garantované pokrytí ani potvrzený výpadek operátora."]),
      maxZoom: 18,
      minZoom: 4,
      provenance: {
        sourceIds: ["sim.situation-data:mobile_network_model"],
        technicalInputs: ["sim.situation-data:mobile_coverage_model", "sim.situation-data:ctu_nettest", "sim.situation-data:osm_postgis"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "sim.situation-data",
        providerLayerIds: ["mobile_network"],
        providerSourceIds: ["mobile_network_model"],
        streamId: "features"
      },
      refreshSeconds: findSource(sources, "mobile_network_model")?.updateCadenceSeconds ?? mobileLayer?.expectedCadenceSeconds ?? 600,
      role: "overlay",
      selectable: true,
      styleProfile: "mobile-network-quality-v1"
    },
    (() => {
      const trafficSources = publicTransitVehicleSources(sources);
      const trafficSourceIds = trafficSources.length > 0 ? trafficSources.map((source) => source.sourceId) : ["pid_gtfs_rt"];
      const trafficRefreshSeconds = Math.min(
        ...trafficSources
          .map((source) => source.updateCadenceSeconds)
          .filter((seconds): seconds is number => typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0),
        trafficLayer?.expectedCadenceSeconds ?? 60
      );
      return {
      audience: "public",
      cacheTtlSeconds: trafficRefreshSeconds,
      defaultVisible: trafficLayer?.defaultVisible ?? false,
      description: trafficLayer?.description ?? "Živá poloha vozidel veřejné dopravy ze SIM.",
      geometryTypes: trafficLayer?.geometryTypes ?? ["Point", "LineString"],
      groupId: "transport",
      kind: "vector_features",
      label: "Veřejná doprava",
      layerId: "public.traffic.transit",
      legal: legalFromSource(trafficSources[0]),
      maxZoom: 18,
      minZoom: 7,
      provenance: {
        sourceIds: trafficSourceIds.map((sourceId) => `sim.situation-data:${sourceId}`)
      },
      query: {
        maxFeatures: 5000,
        mode: "bbox",
        providerId: "sim.situation-data",
        providerLayerIds: ["traffic"],
        providerSourceIds: trafficSourceIds,
        streamId: "features"
      },
      refreshSeconds: trafficRefreshSeconds,
      role: "reference",
      selectable: true,
      styleProfile: "traffic-public-transit-v1"
      };
    })(),
    (() => {
      const stopSources = publicTransitStaticSources(sources);
      if (stopSources.length === 0) {
        return undefined;
      }
      const refreshSeconds = Math.min(
        ...stopSources
          .map((source) => source.updateCadenceSeconds)
          .filter((seconds): seconds is number => typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0),
        3600
      );
      return {
        audience: "public",
        cacheTtlSeconds: refreshSeconds,
        defaultVisible: false,
        description: "Statické zastávky veřejné dopravy ze SIM katalogu.",
        geometryTypes: ["Point"],
        groupId: "transport",
        kind: "vector_features",
        label: "Zastávky veřejné dopravy",
        layerId: "public.traffic.transit_stops",
        legal: legalFromSource(stopSources[0]),
        maxZoom: 18,
        minZoom: 11,
        provenance: {
          sourceIds: stopSources.map((source) => `sim.situation-data:${source.sourceId}`)
        },
        query: {
          maxFeatures: 5000,
          mode: "bbox",
          providerId: "sim.situation-data",
          providerLayerIds: ["traffic"],
          providerSourceIds: stopSources.map((source) => source.sourceId),
          streamId: "features"
        },
        refreshSeconds,
        role: "reference",
        selectable: true,
        styleProfile: "traffic-public-transit-stops-v1"
      } satisfies MapCatalogLayer;
    })(),
    ...buildInfrastructureLayers(groundLayer, sources)
  ].filter((layer): layer is MapCatalogLayer => Boolean(layer));
}

function buildSituationCatalogCompatibilityLayers(catalog: ProviderMapCatalog, sources: SituationSourceDescriptor[]): MapCatalogLayer[] {
  return [
    catalog.layers.some((layer) => layer.recommendedCatalogLayerId === "public.weather.forecast_area")
      ? undefined
      : buildWeatherForecastAreaCatalogLayer(sources),
    catalog.layers.some((layer) => layer.recommendedCatalogLayerId === "public.weather.webcams")
      ? undefined
      : buildWeatherWebcamCatalogLayer(sources)
  ].filter((layer): layer is MapCatalogLayer => Boolean(layer));
}

function buildSituationCatalogCompatibilitySources(catalog: ProviderMapCatalog, sources: SituationSourceDescriptor[]): MapCatalogSource[] {
  const compatibilitySources: MapCatalogSource[] = [];
  if (!catalog.sources.some((source) => source.sourceId === "weather_forecast")) {
    const source = findSource(sources, "weather_forecast");
    const enabled = source?.enabled !== false;
    compatibilitySources.push({
      audience: "public",
      cacheTtlSeconds: source?.updateCadenceSeconds ?? 600,
      enabled,
      feedsCatalogLayerIds: ["public.weather.forecast_area"],
      label: source?.label ?? "Předpověď počasí",
      providerId: "sim.situation-data",
      selectableInMap: enabled,
      sourceId: "weather_forecast",
      sourceRole: "final",
      updateCadenceSeconds: source?.updateCadenceSeconds ?? 600,
      visibleInDiagnostics: true
    });
  }
  if (!catalog.sources.some((source) => source.sourceId === "chmi_weather_webcams")) {
    const source = findSource(sources, "chmi_weather_webcams");
    const enabled = source?.enabled !== false;
    compatibilitySources.push({
      audience: "public",
      cacheTtlSeconds: source?.updateCadenceSeconds ?? 600,
      enabled,
      feedsCatalogLayerIds: ["public.weather.webcams"],
      label: source?.label ?? "ČHMÚ webkamery",
      providerId: "sim.situation-data",
      selectableInMap: enabled,
      sourceId: "chmi_weather_webcams",
      sourceRole: "final",
      updateCadenceSeconds: source?.updateCadenceSeconds ?? 600,
      visibleInDiagnostics: true
    });
  }
  return compatibilitySources;
}

function buildWeatherForecastAreaCatalogLayer(sources: SituationSourceDescriptor[]): MapCatalogLayer {
  const source = findSource(sources, "weather_forecast");
  const refreshSeconds = source?.updateCadenceSeconds ?? 600;
  return {
    audience: "public",
    cacheTtlSeconds: refreshSeconds,
    defaultVisible: false,
    description: "Plošná předpověď počasí ze SIM se symbolem, rizikem a detailním meteogramem.",
    geometryTypes: ["Polygon", "MultiPolygon"],
    groupId: "risks.weather",
    kind: "vector_features",
    label: "Předpověď počasí",
    layerId: "public.weather.forecast_area",
    legal: legalFromSource(source),
    maxZoom: 18,
    minZoom: 4,
    provenance: {
      sourceIds: ["sim.situation-data:weather_forecast"]
    },
    query: {
      maxFeatures: 24,
      mode: "bbox",
      providerId: "sim.situation-data",
      providerLayerIds: ["weather_forecast_area"],
      providerSourceIds: ["weather_forecast"],
      streamId: "features"
    },
    refreshSeconds,
    role: "overlay",
    selectable: true,
    styleProfile: "weather-forecast-area-v1"
  };
}

function buildWeatherWebcamCatalogLayer(sources: SituationSourceDescriptor[]): MapCatalogLayer {
  return {
    audience: "public",
    cacheTtlSeconds: 600,
    defaultVisible: false,
    description: "Webkamery ČHMÚ jako vizuální kontext počasí. Nejde o výstrahu ani automatický incident.",
    geometryTypes: ["Point"],
    groupId: "risks.weather",
    kind: "vector_features",
    label: "Kamery",
    layerId: "public.weather.webcams",
    legal: legalFromSource(findSource(sources, "chmi_weather_webcams"), ["Český hydrometeorologický ústav"]),
    maxZoom: 18,
    minZoom: 4,
    provenance: {
      sourceIds: ["sim.situation-data:chmi_weather_webcams"]
    },
    query: {
      maxFeatures: 200,
      mode: "bbox",
      providerId: "sim.situation-data",
      providerLayerIds: ["weather_webcams"],
      providerSourceIds: ["chmi_weather_webcams"],
      streamId: "features"
    },
    refreshSeconds: findSource(sources, "chmi_weather_webcams")?.updateCadenceSeconds ?? 600,
    role: "overlay",
    selectable: true,
    styleProfile: "weather-webcams-v1"
  };
}

function buildInfrastructureLayers(groundLayer: SituationLayerDescriptor | undefined, sources: SituationSourceDescriptor[]): MapCatalogLayer[] {
  const osm = findSource(sources, "osm_postgis");
  const base = {
    audience: "public" as const,
    cacheTtlSeconds: 21600,
    defaultVisible: false,
    geometryTypes: groundLayer?.geometryTypes ?? ["Point", "LineString", "Polygon"],
    groupId: "infrastructure",
    kind: "vector_features" as const,
    legal: legalFromSource(osm),
    maxZoom: 18,
    minZoom: 9,
    refreshSeconds: osm?.updateCadenceSeconds ?? groundLayer?.expectedCadenceSeconds ?? 21600,
    role: "reference" as const,
    selectable: true
  };
  return [
    {
      ...base,
      description: "Nemocnice, kliniky, lékaři a lékárny z referenčních dat OSM/PostGIS.",
      label: "Zdravotnictví",
      layerId: "reference.infrastructure.healthcare",
      provenance: { sourceIds: ["sim.situation-data:osm_postgis"] },
      query: infrastructureQuery(["hospital", "clinic", "doctors", "pharmacy"]),
      styleProfile: "infrastructure-healthcare-v1"
    },
    {
      ...base,
      description: "Hasiči, policie, záchranné stanice, kryty a nouzové body.",
      label: "Záchranná infrastruktura",
      layerId: "reference.infrastructure.emergency",
      provenance: { sourceIds: ["sim.situation-data:osm_postgis"] },
      query: infrastructureQuery(["fire_station", "police", "ambulance_station", "shelter", "defibrillator", "siren", "assembly_point"]),
      styleProfile: "infrastructure-emergency-v1"
    },
    {
      ...base,
      defaultVisible: false,
      description: "BTS a komunikační stožáry jako referenční kontext, ne stav mobilní sítě.",
      label: "BTS / komunikační stožáry",
      layerId: "reference.infrastructure.communications",
      minZoom: 4,
      provenance: { sourceIds: ["sim.situation-data:osm_postgis"] },
      query: {
        ...infrastructureQuery(["communications_tower"]),
        providerLayerIds: ["mobile"]
      },
      selectable: true,
      styleProfile: "infrastructure-communications-v1"
    }
  ];
}

function infrastructureQuery(categoryIds: string[]): MapCatalogQuery {
  return {
    categoryIds,
    maxFeatures: 250,
    mode: "bbox",
    providerId: "sim.situation-data",
    providerLayerIds: ["ground"],
    providerSourceIds: ["osm_postgis"],
    streamId: "features"
  };
}

function buildDiagnosticLayers(layers: SituationLayerDescriptor[], sources: SituationSourceDescriptor[]): MapCatalogLayer[] {
  const coverageLayer = findLayer(layers, "mobile_coverage");
  const mobileLayer = findLayer(layers, "mobile");
  return [
    {
      audience: "diagnostic",
      cacheTtlSeconds: 21600,
      defaultVisible: false,
      description: coverageLayer?.description ?? "Technický modelový odhad pokrytí ze SIM.",
      filters: [
        {
          defaultValue: ["4G"],
          filterId: "technology",
          label: "Technologie",
          type: "multi_select",
          values: ["2G", "4G", "5G"]
        }
      ],
      geometryTypes: coverageLayer?.geometryTypes ?? ["Polygon"],
      groupId: "diagnostic",
      kind: "vector_features",
      label: "Technický odhad pokrytí",
      layerId: "diagnostic.mobile.coverage",
      legal: legalFromSource(findSource(sources, "mobile_coverage_model")),
      maxZoom: 18,
      minZoom: 6,
      provenance: {
        sourceIds: ["sim.situation-data:mobile_coverage_model"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "sim.situation-data",
        providerLayerIds: ["mobile_coverage"],
        providerSourceIds: ["mobile_coverage_model"],
        streamId: "features"
      },
      refreshSeconds: findSource(sources, "mobile_coverage_model")?.updateCadenceSeconds ?? coverageLayer?.expectedCadenceSeconds ?? 21600,
      role: "diagnostic",
      selectable: false,
      styleProfile: "mobile-coverage-technical-v1"
    },
    {
      audience: "diagnostic",
      cacheTtlSeconds: 3600,
      defaultVisible: false,
      description: "Surová veřejná ČTÚ NetTest měření pro diagnostiku modelu.",
      geometryTypes: mobileLayer?.geometryTypes ?? ["Point"],
      groupId: "diagnostic",
      kind: "vector_features",
      label: "ČTÚ měření",
      layerId: "diagnostic.mobile.ctu_measurements",
      legal: legalFromSource(findSource(sources, "ctu_nettest")),
      maxZoom: 18,
      minZoom: 8,
      provenance: {
        sourceIds: ["sim.situation-data:ctu_nettest"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "sim.situation-data",
        providerLayerIds: ["mobile"],
        providerSourceIds: ["ctu_nettest"],
        streamId: "features"
      },
      refreshSeconds: findSource(sources, "ctu_nettest")?.updateCadenceSeconds ?? mobileLayer?.expectedCadenceSeconds ?? 3600,
      role: "diagnostic",
      selectable: false,
      styleProfile: "mobile-measurements-technical-v1"
    }
  ];
}

function buildTakLayers(layers: TakGatewayLayerDescriptor[], sources: TakGatewaySourceDescriptor[]): MapCatalogLayer[] {
  const source = findSource(sources, "tak_gateway");
  return ([
    ["mobile", "partner.tak.mobile", "Partnerské jednotky", "Pohyblivé partnerské body z TAK/CoT.", "tak-mobile-v1"],
    ["ground", "partner.tak.ground", "Partnerské body", "Statické nebo pomalu se měnící partnerské body.", "tak-ground-v1"],
    ["traffic", "partner.tak.traffic", "Partnerský provoz", "Partnerské transportní a provozní značky.", "tak-traffic-v1"]
  ] as const).map(([providerLayerId, layerId, label, description, styleProfile]) => {
    const layer = findLayer(layers, providerLayerId);
    return {
      audience: "partner" as const,
      cacheTtlSeconds: 5,
      defaultVisible: layer?.defaultVisible ?? providerLayerId === "mobile",
      description: layer?.description ?? description,
      geometryTypes: layer?.geometryTypes ?? ["Point"],
      groupId: "partner",
      kind: "vector_features" as const,
      label,
      layerId,
      legal: legalFromSource(source),
      maxZoom: 18,
      minZoom: 7,
      provenance: {
        sourceIds: ["sim.tak-gateway:tak_gateway"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox" as const,
        providerId: "sim.tak-gateway",
        providerLayerIds: [providerLayerId],
        providerSourceIds: ["tak_gateway"],
        streamId: "features"
      },
      refreshSeconds: layer?.expectedCadenceSeconds ?? source?.updateCadenceSeconds ?? 15,
      role: "partner" as const,
      selectable: true,
      styleProfile
    };
  });
}

function buildMissionArenaLayers(layers: MissionArenaLayerDescriptor[], sources: MissionArenaSourceDescriptor[]): MapCatalogLayer[] {
  const layer = findLayer(layers, "presentation.mission_arena");
  const source = findSource(sources, "mission_arena_runtime");
  if (!layer && !source) {
    return [];
  }
  return [
    {
      audience: "public",
      cacheTtlSeconds: source?.updateCadenceSeconds ?? layer?.expectedCadenceSeconds ?? 5,
      defaultVisible: layer?.defaultVisible ?? false,
      description: layer?.description ?? "Prezentační stav Mission Arena eventu. COP skóre nepočítá, pouze zobrazuje poskytnutý stav.",
      geometryTypes: layer?.geometryTypes ?? ["Point", "Polygon"],
      groupId: "presentation",
      kind: "vector_features",
      label: layer?.label ?? "Mission Arena",
      layerId: "presentation.mission_arena",
      legal: {
        notes: [
          "Prezentační/eventový zdroj. Nejde o reálné operační velení ani doporučení akce.",
          "Skóre, fázi a stav týmů počítá Mission Arena; COP je pouze zobrazuje."
        ]
      },
      maxZoom: 18,
      minZoom: 5,
      provenance: {
        sourceIds: ["csm.mission-arena:mission_arena_runtime"]
      },
      query: {
        maxFeatures: 50,
        mode: "bbox",
        providerId: "csm.mission-arena",
        providerLayerIds: ["presentation.mission_arena"],
        providerSourceIds: ["mission_arena_runtime"],
        streamId: "export"
      },
      refreshSeconds: source?.updateCadenceSeconds ?? layer?.expectedCadenceSeconds ?? 5,
      role: "overlay",
      selectable: true,
      styleProfile: "mission-arena-v1"
    }
  ];
}

function buildCopOwnedLayers(): MapCatalogLayer[] {
  return [
    {
      audience: "public",
      cacheTtlSeconds: 5,
      defaultVisible: true,
      description: "Veřejná letová data agregovaná přes SIM flight-data.",
      geometryTypes: ["Point"],
      groupId: "flight",
      kind: "track_stream",
      label: "Veřejné lety",
      layerId: "flight.public.tracks",
      maxZoom: 18,
      minZoom: 4,
      provenance: {
        sourceIds: ["sim.flight-data"]
      },
      query: {
        maxFeatures: 500,
        mode: "stream",
        providerId: "cop.tracks",
        streamId: "cop.live"
      },
      refreshSeconds: 5,
      role: "primary",
      selectable: true,
      styleProfile: "flight-public-track-v1"
    },
    {
      audience: "public",
      cacheTtlSeconds: 5,
      defaultVisible: true,
      description: "Simulovaná letecká situace ze SIM track streamu.",
      geometryTypes: ["Point"],
      groupId: "flight",
      kind: "track_stream",
      label: "Simulace",
      layerId: "flight.sim.tracks",
      maxZoom: 18,
      minZoom: 4,
      provenance: {
        sourceIds: ["sim.air-situation"]
      },
      query: {
        maxFeatures: 500,
        mode: "stream",
        providerId: "cop.tracks",
        streamId: "cop.live"
      },
      refreshSeconds: 5,
      role: "primary",
      selectable: true,
      styleProfile: "sim-air-track-v1"
    },
    {
      audience: "public",
      cacheTtlSeconds: 3600,
      defaultVisible: false,
      description: "Letiště a heliporty jako referenční letecká vrstva.",
      geometryTypes: ["Point"],
      groupId: "flight",
      kind: "vector_features",
      label: "Letiště",
      layerId: "flight.reference.airports",
      maxZoom: 18,
      minZoom: 7,
      provenance: {
        sourceIds: ["sim.flight-data:airports"]
      },
      query: {
        maxFeatures: 200,
        mode: "bbox",
        providerId: "sim.flight-data",
        streamId: "airports"
      },
      refreshSeconds: 3600,
      role: "reference",
      selectable: true,
      styleProfile: "airport-reference-v1"
    },
    {
      audience: "authenticated",
      cacheTtlSeconds: 30,
      defaultVisible: true,
      description: "Uživatelské zájmové a výstražné zóny.",
      geometryTypes: ["Point", "Polygon"],
      groupId: "user",
      kind: "user_objects",
      label: "Uživatelské zóny",
      layerId: "user.zone.alerts",
      maxZoom: 18,
      minZoom: 5,
      provenance: {
        sourceIds: ["cop.user-profile"]
      },
      query: {
        mode: "internal",
        providerId: "cop.user-profile",
        streamId: "user.zones"
      },
      refreshSeconds: 30,
      role: "user",
      selectable: true,
      styleProfile: "user-alert-zone-v1"
    },
    {
      audience: "authenticated",
      cacheTtlSeconds: 30,
      defaultVisible: true,
      description: "Uživatelské zákresy, texty, značky a měření nad mapou.",
      geometryTypes: ["Point", "LineString", "Polygon"],
      groupId: "user",
      kind: "user_objects",
      label: "Zákresy",
      layerId: "user.sketch.drawings",
      maxZoom: 22,
      minZoom: 4,
      provenance: {
        sourceIds: ["cop.sketch"]
      },
      query: {
        mode: "internal",
        providerId: "cop.sketch",
        streamId: "user.sketch.drawings"
      },
      refreshSeconds: 30,
      role: "user",
      selectable: true,
      styleProfile: "user-sketch-drawings-v1"
    },
    {
      audience: "public",
      cacheTtlSeconds: 30,
      defaultVisible: true,
      description: "Komunitní hlášení uživatelů s médii a ověřenou polohou.",
      geometryTypes: ["Point"],
      groupId: "user",
      kind: "user_objects",
      label: "Hlášení uživatelů",
      layerId: "user.community.reports",
      maxZoom: 18,
      minZoom: 7,
      provenance: {
        sourceIds: ["cop.community"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "cop.community",
        streamId: "community.reports"
      },
      refreshSeconds: 30,
      role: "user",
      selectable: true,
      styleProfile: "community-report-v1"
    }
  ];
}

function buildCopSources(): MapCatalogSource[] {
  return [
    {
      audience: "public",
      cacheTtlSeconds: 5,
      enabled: true,
      feedsCatalogLayerIds: ["flight.public.tracks", "flight.sim.tracks"],
      label: "COP current track state",
      providerId: "cop.tracks",
      selectableInMap: false,
      sourceId: "current_tracks",
      sourceRole: "aggregate",
      updateCadenceSeconds: 5,
      visibleInDiagnostics: true
    },
    {
      audience: "public",
      cacheTtlSeconds: 3600,
      enabled: true,
      feedsCatalogLayerIds: ["flight.reference.airports"],
      label: "Flight airport reference",
      providerId: "sim.flight-data",
      selectableInMap: false,
      sourceId: "airports",
      sourceRole: "reference",
      updateCadenceSeconds: 3600,
      visibleInDiagnostics: true
    },
    {
      audience: "authenticated",
      cacheTtlSeconds: 30,
      enabled: true,
      feedsCatalogLayerIds: ["user.zone.alerts"],
      label: "User alert zones",
      providerId: "cop.user-profile",
      selectableInMap: false,
      sourceId: "user_zones",
      sourceRole: "final",
      updateCadenceSeconds: 30,
      visibleInDiagnostics: true
    },
    {
      audience: "authenticated",
      cacheTtlSeconds: 30,
      enabled: true,
      feedsCatalogLayerIds: ["user.sketch.drawings"],
      label: "User sketches",
      providerId: "cop.sketch",
      selectableInMap: false,
      sourceId: "user_sketch_drawings",
      sourceRole: "final",
      updateCadenceSeconds: 30,
      visibleInDiagnostics: true
    },
    {
      audience: "public",
      cacheTtlSeconds: 30,
      enabled: true,
      feedsCatalogLayerIds: ["user.community.reports"],
      label: "Community reports",
      providerId: "cop.community",
      selectableInMap: false,
      sourceId: "community_reports",
      sourceRole: "final",
      updateCadenceSeconds: 30,
      visibleInDiagnostics: true
    }
  ];
}

function buildSafetySources(sources: SafetySourceDescriptor[]): MapCatalogSource[] {
  return sources.map((source) => ({
    audience: source.sourceId === "mock" ? "diagnostic" : "public",
    cacheTtlSeconds: source.updateCadenceSeconds,
    enabled: source.enabled !== false,
    feedsCatalogLayerIds: safetyFeedsCatalogLayerIds(source.sourceId),
    label: source.label ?? source.sourceId,
    providerId: "sim.safety-data",
    selectableInMap: source.enabled !== false && source.sourceId !== "mock",
    sourceId: source.sourceId,
    sourceRole: source.sourceId === "mock" ? "mock" : source.sourceId === "admin_boundaries" ? "reference" : "final",
    updateCadenceSeconds: source.updateCadenceSeconds,
    visibleInDiagnostics: true
  }));
}

function safetyFeedsCatalogLayerIds(sourceId: SafetyDataSourceId): string[] | undefined {
  if (sourceId === "admin_boundaries") {
    return ["public.boundary.admin"];
  }
  if (sourceId === "chmi_alerts") {
    return ["public.safety.fire", "public.safety.weather_alerts"];
  }
  if (sourceId === "chmi_hydro") {
    return ["public.safety.flood"];
  }
  if (sourceId === "gdacs_alerts") {
    return ["public.safety.warnings", "public.safety.fire", "public.safety.flood"];
  }
  if (sourceId === "hzs_incidents") {
    return ["public.safety.warnings", "public.safety.fire"];
  }
  if (sourceId === "road_srti_lod") {
    return ["public.safety.warnings"];
  }
  if (sourceId === "nasa_firms" || sourceId === "fire_hotspots" || sourceId === "fire_incidents") {
    return ["public.safety.fire"];
  }
  if (sourceId === "weather_alerts") {
    return ["public.safety.weather_alerts"];
  }
  return undefined;
}

function buildSituationSources(sources: SituationSourceDescriptor[]): MapCatalogSource[] {
  return sources.map((source) => {
    const classification = classifySituationSource(source.sourceId);
    return {
      audience: classification.audience,
      cacheTtlSeconds: source.updateCadenceSeconds,
      enabled: source.enabled !== false,
      feedsCatalogLayerIds: classification.feedsCatalogLayerIds,
      label: source.label ?? source.sourceId,
      providerId: "sim.situation-data",
      selectableInMap: source.enabled !== false && classification.selectableInMap,
      sourceId: source.sourceId,
      sourceRole: classification.sourceRole,
      updateCadenceSeconds: source.updateCadenceSeconds,
      usedByCatalogLayerIds: classification.usedByCatalogLayerIds,
      visibleInDiagnostics: true
    };
  });
}

function classifySituationSource(sourceId: string): Pick<MapCatalogSource, "audience" | "feedsCatalogLayerIds" | "selectableInMap" | "sourceRole" | "usedByCatalogLayerIds"> {
  switch (sourceId) {
    case "open_meteo":
      return { audience: "public", feedsCatalogLayerIds: ["public.weather.current"], selectableInMap: false, sourceRole: "reference" };
    case "aviation_weather":
      return { audience: "public", feedsCatalogLayerIds: ["public.weather.aviation"], selectableInMap: true, sourceRole: "final" };
    case "chmi_weather_stations":
      return { audience: "public", feedsCatalogLayerIds: ["public.weather.observations"], selectableInMap: true, sourceRole: "final" };
    case "weather_forecast":
      return { audience: "public", feedsCatalogLayerIds: ["public.weather.forecast_area"], selectableInMap: true, sourceRole: "final" };
    case "chmi_weather_webcams":
      return { audience: "public", feedsCatalogLayerIds: ["public.weather.webcams"], selectableInMap: true, sourceRole: "final" };
    case "chmi_air_quality":
      return { audience: "public", feedsCatalogLayerIds: ["public.safety.air_quality"], selectableInMap: true, sourceRole: "final" };
    case "mobile_network_model":
      return { audience: "public", feedsCatalogLayerIds: ["public.mobile.network"], selectableInMap: true, sourceRole: "aggregate" };
    case "mobile_coverage_model":
      return { audience: "diagnostic", feedsCatalogLayerIds: ["diagnostic.mobile.coverage"], selectableInMap: false, sourceRole: "input", usedByCatalogLayerIds: ["public.mobile.network"] };
    case "ctu_nettest":
      return { audience: "diagnostic", feedsCatalogLayerIds: ["diagnostic.mobile.ctu_measurements"], selectableInMap: false, sourceRole: "input", usedByCatalogLayerIds: ["public.mobile.network"] };
    case "osm_postgis":
      return {
        audience: "public",
        feedsCatalogLayerIds: ["reference.infrastructure.healthcare", "reference.infrastructure.emergency", "reference.infrastructure.communications"],
        selectableInMap: false,
        sourceRole: "reference",
        usedByCatalogLayerIds: ["public.mobile.network"]
      };
    case "osm_overpass":
      return { audience: "diagnostic", feedsCatalogLayerIds: ["diagnostic.osm.overpass"], selectableInMap: false, sourceRole: "diagnostic" };
    case "pid_gtfs_rt":
      return { audience: "public", feedsCatalogLayerIds: ["public.traffic.transit"], selectableInMap: true, sourceRole: "final" };
    case "public_transit_static":
      return { audience: "public", feedsCatalogLayerIds: ["public.traffic.transit_stops"], selectableInMap: true, sourceRole: "reference" };
    case "ids_jmk_gtfs_rt":
    case "idsjmk_gtfs_rt":
    case "ids_jmk_vehicle_positions":
    case "idsjmk_vehicle_positions":
    case "transit_vehicle_positions":
    case "transit_gtfs_rt":
      return { audience: "public", feedsCatalogLayerIds: ["public.traffic.transit"], selectableInMap: true, sourceRole: "final" };
    case "safety_data":
      return { audience: "public", feedsCatalogLayerIds: ["public.safety.warnings", "public.safety.flood", "public.safety.fire", "public.safety.weather_alerts"], selectableInMap: false, sourceRole: "projection" };
    case "ardos_partner":
      return { audience: "partner", feedsCatalogLayerIds: ["partner.ardos"], selectableInMap: false, sourceRole: "final" };
    case "mock":
      return { audience: "diagnostic", feedsCatalogLayerIds: undefined, selectableInMap: false, sourceRole: "mock" };
    default:
      return { audience: "diagnostic", feedsCatalogLayerIds: undefined, selectableInMap: false, sourceRole: "diagnostic" };
  }
}

function buildMissionArenaSources(sources: MissionArenaSourceDescriptor[]): MapCatalogSource[] {
  return sources.map((source) => ({
    audience: "public",
    cacheTtlSeconds: source.updateCadenceSeconds,
    enabled: source.enabled !== false,
    feedsCatalogLayerIds: ["presentation.mission_arena"],
    label: source.label ?? source.sourceId,
    providerId: "csm.mission-arena",
    selectableInMap: source.enabled !== false,
    sourceId: source.sourceId,
    sourceRole: "final",
    updateCadenceSeconds: source.updateCadenceSeconds,
    visibleInDiagnostics: true
  }));
}

function buildTakSources(sources: TakGatewaySourceDescriptor[]): MapCatalogSource[] {
  return sources.map((source) => ({
    audience: "partner",
    cacheTtlSeconds: source.updateCadenceSeconds,
    enabled: source.enabled !== false,
    feedsCatalogLayerIds: ["partner.tak.mobile", "partner.tak.ground", "partner.tak.traffic"],
    label: source.label ?? source.sourceId,
    providerId: "sim.tak-gateway",
    selectableInMap: source.enabled !== false,
    sourceId: source.sourceId,
    sourceRole: "final",
    updateCadenceSeconds: source.updateCadenceSeconds,
    visibleInDiagnostics: true
  }));
}

function legalFromSource(source: { license?: Record<string, unknown> } | undefined, notes: string[] = []): MapCatalogLayer["legal"] | undefined {
  const license = source?.license;
  const attribution = typeof license?.attribution === "string" ? license.attribution : undefined;
  const licenseNotes = Array.isArray(license?.notes) ? license.notes.filter((item): item is string => typeof item === "string") : [];
  if (!attribution && licenseNotes.length === 0 && notes.length === 0) {
    return undefined;
  }
  return {
    ...(attribution ? { attribution } : {}),
    notes: [...licenseNotes, ...notes]
  };
}

function findLayer<T extends { layerId: string }>(layers: T[], layerId: string): T | undefined {
  return layers.find((layer) => layer.layerId === layerId);
}

function publicTransitStaticSources(sources: SituationSourceDescriptor[]): SituationSourceDescriptor[] {
  return sources.filter((source) => isPublicTransitStaticSourceId(source.sourceId));
}

function publicTransitVehicleSources(sources: SituationSourceDescriptor[]): SituationSourceDescriptor[] {
  return sources.filter((source) => {
    if (isPublicTransitStaticSourceId(source.sourceId)) {
      return false;
    }
    if (source.layers?.includes("traffic")) {
      return true;
    }
    const sourceId = source.sourceId.toLowerCase();
    return sourceId.includes("gtfs")
      || sourceId.includes("transit")
      || sourceId.includes("vehicle_position")
      || sourceId.includes("pid_")
      || sourceId.includes("ids_jmk")
      || sourceId.includes("idsjmk");
  });
}

function isPublicTransitStaticSourceId(sourceId: string): boolean {
  const normalized = sourceId.toLowerCase();
  return normalized === "public_transit_static"
    || normalized.includes("transit_static")
    || normalized.includes("gtfs_static");
}

function findSource<T extends { sourceId: string }>(sources: T[], sourceId: string): T | undefined {
  return sources.find((source) => source.sourceId === sourceId);
}

function nonEmpty<T>(value: T[] | undefined): T[] | undefined {
  return value && value.length > 0 ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function filterCompatibilityLayers(layers: MapCatalogLayer[], providers: MapCatalogProvider[]): MapCatalogLayer[] {
  return layers.filter((layer) => {
    if (layer.compatibilityOnly !== true || !layer.preferredProviderId || !providerIsOnline(providers, layer.preferredProviderId)) {
      return true;
    }
    return !layers.some((candidate) =>
      candidate.layerId === layer.layerId
      && candidate.query.providerId === layer.preferredProviderId
      && candidate.compatibilityOnly !== true
    );
  });
}

function filterCompatibilitySources(sources: MapCatalogSource[], layers: MapCatalogLayer[], providers: MapCatalogProvider[]): MapCatalogSource[] {
  return sources.filter((source) => {
    if (source.compatibilityOnly !== true || !source.preferredProviderId || !providerIsOnline(providers, source.preferredProviderId)) {
      return true;
    }
    const feedsCatalogLayerIds = source.feedsCatalogLayerIds ?? [];
    if (feedsCatalogLayerIds.length === 0) {
      return false;
    }
    return layers.some((layer) =>
      layer.compatibilityOnly === true
      && layer.query.providerId === source.providerId
      && feedsCatalogLayerIds.includes(layer.layerId)
    );
  });
}

function providerIsOnline(providers: MapCatalogProvider[], providerId: string): boolean {
  return providers.some((provider) => provider.providerId === providerId && provider.status === "online");
}

function dedupeLayers(layers: MapCatalogLayer[]): MapCatalogLayer[] {
  const byId = new Map<string, MapCatalogLayer>();
  layers.forEach((layer) => {
    const existing = byId.get(layer.layerId);
    if (!existing) {
      byId.set(layer.layerId, layer);
    } else {
      byId.set(layer.layerId, mergeCatalogLayers(existing, layer));
    }
  });
  return Array.from(byId.values());
}

function mergeCatalogLayers(existing: MapCatalogLayer, next: MapCatalogLayer): MapCatalogLayer {
  const existingAvailable = existing.enabled !== false && existing.availability !== "disabled";
  const nextAvailable = next.enabled !== false && next.availability !== "disabled";
  const base = existingAvailable || !nextAvailable ? existing : next;
  const mergeFrom = [existing, next].filter((layer) => {
    if (existingAvailable || nextAvailable) {
      return layer.enabled !== false && layer.availability !== "disabled";
    }
    return true;
  });
  const providerLayerIds = uniqueStrings(mergeFrom.flatMap((layer) => layer.query.providerLayerIds ?? []));
  const providerSourceIds = uniqueStrings(mergeFrom.flatMap((layer) => layer.query.providerSourceIds ?? []));
  const categoryIds = uniqueStrings(mergeFrom.flatMap((layer) => layer.query.categoryIds ?? []));
  const provenanceSourceIds = uniqueStrings(mergeFrom.flatMap((layer) => layer.provenance?.sourceIds ?? []));
  const technicalInputs = uniqueStrings(mergeFrom.flatMap((layer) => layer.provenance?.technicalInputs ?? []));
  const maxFeatures = Math.max(...mergeFrom.map((layer) => layer.query.maxFeatures ?? 0));
  const minRefreshSeconds = minPositiveNumber(mergeFrom.map((layer) => layer.refreshSeconds));
  const minCacheTtlSeconds = minPositiveNumber(mergeFrom.map((layer) => layer.cacheTtlSeconds));
  const hasAvailableLayer = existingAvailable || nextAvailable;
  return {
    ...base,
    ...(hasAvailableLayer ? { availability: "available" } : {}),
    ...(minCacheTtlSeconds !== undefined ? { cacheTtlSeconds: minCacheTtlSeconds } : {}),
    defaultVisible: existing.defaultVisible || next.defaultVisible,
    ...(hasAvailableLayer ? { disabledReason: undefined } : {}),
    ...(hasAvailableLayer ? { enabled: true } : {}),
    geometryTypes: uniqueStrings([...(existing.geometryTypes ?? []), ...(next.geometryTypes ?? [])]),
    legal: base.legal ?? existing.legal ?? next.legal,
    maxZoom: maxOptionalNumber([existing.maxZoom, next.maxZoom]),
    minZoom: minOptionalNumber([existing.minZoom, next.minZoom]),
    provenance: {
      sourceIds: provenanceSourceIds,
      ...(technicalInputs.length > 0 ? { technicalInputs } : {})
    },
    query: {
      ...base.query,
      ...(categoryIds.length > 0 ? { categoryIds } : {}),
      ...(maxFeatures > 0 ? { maxFeatures } : {}),
      ...(providerLayerIds.length > 0 ? { providerLayerIds } : {}),
      ...(providerSourceIds.length > 0 ? { providerSourceIds } : {})
    },
    ...(minRefreshSeconds !== undefined ? { refreshSeconds: minRefreshSeconds } : {}),
    selectable: hasAvailableLayer && (existing.selectable || next.selectable)
  };
}

function minPositiveNumber(values: Array<number | undefined>): number | undefined {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return finiteValues.length > 0 ? Math.min(...finiteValues) : undefined;
}

function minOptionalNumber(values: Array<number | undefined>): number | undefined {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length > 0 ? Math.min(...finiteValues) : undefined;
}

function maxOptionalNumber(values: Array<number | undefined>): number | undefined {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length > 0 ? Math.max(...finiteValues) : undefined;
}

function dedupeSources(sources: MapCatalogSource[]): MapCatalogSource[] {
  const byId = new Map<string, MapCatalogSource>();
  sources.forEach((source) => {
    const key = `${source.providerId}:${source.sourceId}`;
    if (!byId.has(key)) {
      byId.set(key, source);
    }
  });
  return Array.from(byId.values());
}
