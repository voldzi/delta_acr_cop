import type { SafetyLayerDescriptor, SafetySourceDescriptor } from "./safety-data-source.js";
import type { SituationLayerDescriptor, SituationSourceDescriptor } from "./situation-data-source.js";
import type { TakGatewayLayerDescriptor, TakGatewaySourceDescriptor } from "./tak-gateway-source.js";
import type { MissionArenaLayerDescriptor, MissionArenaSourceDescriptor } from "./mission-arena-source.js";
import type { ProviderCatalogLayer, ProviderCatalogSource, ProviderMapCatalog } from "./provider-map-catalog.js";

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
  const sources = [
    ...buildCopSources(),
    ...(input.safety?.catalog ? buildProviderCatalogSources(input.safety.catalog, includeDiagnostics, includePartner) : buildSafetySources(input.safety?.sources ?? [])),
    ...(input.situation?.catalog ? buildProviderCatalogSources(input.situation.catalog, includeDiagnostics, includePartner) : buildSituationSources(input.situation?.sources ?? [])),
    ...(input.flight?.catalog ? buildProviderCatalogSources(input.flight.catalog, includeDiagnostics, includePartner) : []),
    ...buildMissionArenaSources(input.missionArena?.sources ?? []),
    ...(includePartner ? (input.tak?.catalog ? buildProviderCatalogSources(input.tak.catalog, includeDiagnostics, includePartner) : buildTakSources(input.tak?.sources ?? [])) : [])
  ];
  const allLayers = [
    ...(input.safety?.catalog ? buildProviderCatalogLayers(input.safety.catalog, includeDiagnostics, includePartner) : buildSafetyLayers(input.safety?.layers ?? [], input.safety?.sources ?? [])),
    ...(input.situation?.catalog ? buildProviderCatalogLayers(input.situation.catalog, includeDiagnostics, includePartner) : buildSituationLayers(input.situation?.layers ?? [], input.situation?.sources ?? [])),
    ...buildCopOwnedLayers(),
    ...(input.flight?.catalog ? buildProviderCatalogLayers(input.flight.catalog, includeDiagnostics, includePartner) : []),
    ...buildMissionArenaLayers(input.missionArena?.layers ?? [], input.missionArena?.sources ?? []),
    ...(includePartner ? (input.tak?.catalog ? buildProviderCatalogLayers(input.tak.catalog, includeDiagnostics, includePartner) : buildTakLayers(input.tak?.layers ?? [], input.tak?.sources ?? [])) : []),
    ...(includeDiagnostics ? buildDiagnosticLayers(input.situation?.layers ?? [], input.situation?.sources ?? []) : [])
  ];
  const warnings = [input.flight?.warning, input.missionArena?.warning, input.safety?.warning, input.situation?.warning, input.tak?.warning].filter((warning): warning is string => Boolean(warning));

  return {
    catalogVersion: "map-catalog-v1",
    generatedAt: input.generatedAt.toISOString(),
    groups: defaultGroups(includeDiagnostics, includePartner),
    layers: dedupeLayers(allLayers),
    locale: input.locale ?? "cs-CZ",
    providers,
    sources: dedupeSources(sources),
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
  const mode = normalizeQueryMode(layer.query?.mode);
  const role = normalizeLayerRole(layer.role);
  const audience = normalizeAudience(layer.audience);
  const kind = normalizeLayerKind(layer.kind);
  const providerLayerIds = layer.query?.providerLayerIds?.filter(Boolean) ?? [];
  const providerSourceIds = layer.query?.providerSourceIds?.filter(Boolean) ?? layer.sourceIds?.filter(Boolean) ?? [];
  const categoryIds = uniqueStrings([
    ...(layer.query?.categoryIds ?? []),
    ...(layer.query?.categoryFilter ?? []),
    ...(legacyCategoryIdsForProviderLayer(layer.recommendedCatalogLayerId, providerLayerIds, providerSourceIds))
  ]);
  return [
    {
      audience,
      cacheTtlSeconds: layer.cacheTtlSeconds,
      defaultVisible: layer.defaultVisible === true,
      description: layer.description,
      filters: normalizeProviderFilters(layer.filters),
      geometryTypes: nonEmpty(layer.geometryTypes),
      groupId: groupIdForCatalogLayer(layer),
      kind,
      label: labelForCatalogLayer(layer),
      layerId: layer.recommendedCatalogLayerId,
      legal: layer.legal,
      maxZoom: layer.maxZoom,
      minZoom: layer.minZoom,
      provenance: {
        sourceIds: uniqueStrings((layer.sourceIds ?? providerSourceIds).map((sourceId) => `${providerId}:${sourceId}`)),
        ...(layer.technicalInputs && layer.technicalInputs.length > 0 ? { technicalInputs: layer.technicalInputs.map((sourceId) => `${providerId}:${sourceId}`) } : {})
      },
      query: {
        ...(categoryIds.length > 0 ? { categoryIds } : {}),
        maxFeatures: layer.query?.maxFeatures,
        mode,
        providerId: layer.query?.providerId ?? providerId,
        ...(providerLayerIds.length > 0 ? { providerLayerIds } : {}),
        ...(providerSourceIds.length > 0 ? { providerSourceIds } : {}),
        streamId: streamIdForCatalogLayer(layer.query?.streamId)
      },
      refreshSeconds: layer.refreshSeconds,
      role,
      selectable: selectableForCatalogLayer(layer),
      styleProfile: layer.styleProfile ?? styleProfileForCatalogLayer(layer)
    }
  ];
}

function buildProviderCatalogSources(catalog: ProviderMapCatalog, includeDiagnostics: boolean, includePartner: boolean): MapCatalogSource[] {
  return catalog.sources
    .filter((source) => shouldIncludeCatalogAudience(source.audience, includeDiagnostics, includePartner))
    .flatMap((source) => providerCatalogSourceToMapSource(catalog.providerId, source));
}

function providerCatalogSourceToMapSource(providerId: string, source: ProviderCatalogSource): MapCatalogSource[] {
  return [
    {
      audience: normalizeAudience(source.audience),
      cacheTtlSeconds: source.cacheTtlSeconds,
      enabled: source.enabled === true,
      feedsCatalogLayerIds: nonEmpty(source.feedsCatalogLayerIds) ?? nonEmpty(source.feedsLayerIds),
      label: source.label ?? source.sourceId,
      providerId,
      selectableInMap: source.selectableInMap === true,
      sourceId: source.sourceId,
      sourceRole: normalizeSourceRole(source.sourceRole),
      updateCadenceSeconds: source.updateCadenceSeconds,
      usedByCatalogLayerIds: nonEmpty(source.usedByCatalogLayerIds),
      visibleInDiagnostics: source.visibleInDiagnostics === true || normalizeAudience(source.audience) === "diagnostic"
    }
  ];
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

function selectableForCatalogLayer(layer: ProviderCatalogLayer): boolean {
  if (layer.recommendedCatalogLayerId === "reference.infrastructure.communications") {
    return true;
  }
  return layer.selectable === true;
}

function labelForCatalogLayer(layer: ProviderCatalogLayer): string {
  if (layer.recommendedCatalogLayerId === "reference.infrastructure.communications") {
    return "BTS / komunikační stožáry";
  }
  if (layer.recommendedCatalogLayerId === "flight.public.tracks") {
    return "Veřejné lety";
  }
  return layer.label;
}

function groupIdForCatalogLayer(layer: ProviderCatalogLayer): string {
  const layerId = layer.recommendedCatalogLayerId;
  if (layerId.startsWith("public.safety.")) {
    return "risks";
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

function legacyCategoryIdsForProviderLayer(layerId: string, providerLayerIds: string[], providerSourceIds: string[]): string[] {
  if (layerId === "reference.infrastructure.healthcare") {
    return ["hospital", "clinic", "doctors", "pharmacy"];
  }
  if (layerId === "reference.infrastructure.emergency") {
    return ["fire_station", "police", "ambulance_station", "shelter", "defibrillator", "siren", "assembly_point"];
  }
  if (layerId === "reference.infrastructure.communications" || (providerLayerIds.includes("mobile") && providerSourceIds.includes("osm_postgis"))) {
    return ["communications_tower"];
  }
  if (layerId === "reference.infrastructure.civic") {
    return ["townhall"];
  }
  if (layerId === "public.weather.aviation") {
    return ["aviation_weather_station"];
  }
  return [];
}

function normalizeQueryMode(value: string | undefined): MapCatalogQuery["mode"] {
  return value === "internal" || value === "stream" || value === "tile" || value === "bbox" ? value : "bbox";
}

function normalizeLayerRole(value: string | undefined): MapCatalogLayerRole {
  return value === "diagnostic" || value === "overlay" || value === "partner" || value === "primary" || value === "reference" || value === "user" ? value : "reference";
}

function normalizeAudience(value: string | undefined): MapCatalogAudience {
  return value === "admin" || value === "authenticated" || value === "diagnostic" || value === "partner" || value === "public" ? value : "public";
}

function normalizeLayerKind(value: string | undefined): MapCatalogLayerKind {
  return value === "aggregate" || value === "mvt_tiles" || value === "raster_tiles" || value === "static_reference" || value === "track_stream" || value === "user_objects" || value === "vector_features"
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
  const warningLayer = findLayer(layers, "warnings");
  const floodLayer = findLayer(layers, "flood");
  const fireLayer = findLayer(layers, "fire");
  const weatherAlertsLayer = findLayer(layers, "weather_alerts");
  return [
    {
      audience: "public",
      cacheTtlSeconds: 120,
      defaultVisible: warningLayer?.defaultVisible ?? true,
      description: warningLayer?.description ?? "Veřejné výstrahy a rizikové události.",
      geometryTypes: warningLayer?.geometryTypes ?? ["Point", "Polygon"],
      groupId: "risks",
      kind: "vector_features",
      label: "Veřejné výstrahy",
      layerId: "public.safety.warnings",
      legal: legalFromSource(findSource(sources, "chmi_alerts")),
      maxZoom: 18,
      minZoom: 5,
      provenance: {
        sourceIds: ["sim.safety-data:chmi_alerts"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "sim.safety-data",
        providerLayerIds: ["warnings"],
        providerSourceIds: ["chmi_alerts"],
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
      description: floodLayer?.description ?? "Hydrologické stanice, povodňové stupně a vodní kontext.",
      geometryTypes: floodLayer?.geometryTypes ?? ["Point"],
      groupId: "risks",
      kind: "vector_features",
      label: "Povodně a voda",
      layerId: "public.safety.flood",
      legal: legalFromSource(findSource(sources, "chmi_hydro")),
      maxZoom: 18,
      minZoom: 7,
      provenance: {
        sourceIds: ["sim.safety-data:chmi_hydro"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "sim.safety-data",
        providerLayerIds: ["flood"],
        providerSourceIds: ["chmi_hydro"],
        streamId: "features"
      },
      refreshSeconds: floodLayer?.expectedCadenceSeconds ?? 600,
      role: "primary",
      selectable: true,
      styleProfile: "water-level-v1"
    },
    ...(fireLayer
      ? [
          {
            audience: "public" as const,
            cacheTtlSeconds: 600,
            defaultVisible: fireLayer.defaultVisible,
            description: fireLayer.description ?? "Požáry, hotspoty a ověřené požární incidenty.",
            geometryTypes: fireLayer.geometryTypes ?? ["Point", "Polygon"],
            groupId: "risks",
            kind: "vector_features" as const,
            label: "Požáry",
            layerId: "public.safety.fire",
            legal: legalFromSource(findSource(sources, "fire_hotspots") ?? findSource(sources, "fire_incidents")),
            maxZoom: 18,
            minZoom: 5,
            provenance: {
              sourceIds: ["sim.safety-data:fire_hotspots", "sim.safety-data:fire_incidents"]
            },
            query: {
              maxFeatures: 250,
              mode: "bbox" as const,
              providerId: "sim.safety-data",
              providerLayerIds: ["fire"],
              providerSourceIds: ["fire_hotspots", "fire_incidents"],
              streamId: "features"
            },
            refreshSeconds: fireLayer.expectedCadenceSeconds ?? 600,
            role: "primary" as const,
            selectable: true,
            styleProfile: "fire-risk-v1"
          }
        ]
      : []),
    ...(weatherAlertsLayer
      ? [
          {
            audience: "public" as const,
            cacheTtlSeconds: 300,
            defaultVisible: weatherAlertsLayer.defaultVisible,
            description: weatherAlertsLayer.description ?? "Meteorologické výstrahy podle území, typu nebezpečí a platnosti.",
            geometryTypes: weatherAlertsLayer.geometryTypes ?? ["Polygon"],
            groupId: "risks.weather",
            kind: "vector_features" as const,
            label: "Meteorologické výstrahy",
            layerId: "public.safety.weather_alerts",
            legal: legalFromSource(findSource(sources, "weather_alerts") ?? findSource(sources, "chmi_alerts")),
            maxZoom: 18,
            minZoom: 5,
            provenance: {
              sourceIds: ["sim.safety-data:weather_alerts"]
            },
            query: {
              maxFeatures: 250,
              mode: "bbox" as const,
              providerId: "sim.safety-data",
              providerLayerIds: ["weather_alerts"],
              providerSourceIds: ["weather_alerts"],
              streamId: "features"
            },
            refreshSeconds: weatherAlertsLayer.expectedCadenceSeconds ?? 300,
            role: "primary" as const,
            selectable: true,
            styleProfile: "weather-alert-area-v1"
          }
        ]
      : [])
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
      defaultVisible: weatherLayer?.defaultVisible ?? true,
      description: "Aktuální počasí pro zobrazený výřez mapy.",
      geometryTypes: weatherLayer?.geometryTypes ?? ["Point"],
      groupId: "risks.weather",
      kind: "vector_features",
      label: "Počasí",
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
      role: "primary",
      selectable: true,
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
      minZoom: 6,
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
    {
      audience: "public",
      cacheTtlSeconds: 60,
      defaultVisible: trafficLayer?.defaultVisible ?? false,
      description: trafficLayer?.description ?? "Veřejná doprava a dopravní kontext.",
      geometryTypes: trafficLayer?.geometryTypes ?? ["Point", "LineString"],
      groupId: "transport",
      kind: "vector_features",
      label: "Doprava",
      layerId: "public.traffic.transit",
      legal: legalFromSource(findSource(sources, "pid_gtfs_rt")),
      maxZoom: 18,
      minZoom: 8,
      provenance: {
        sourceIds: ["sim.situation-data:pid_gtfs_rt"]
      },
      query: {
        maxFeatures: 250,
        mode: "bbox",
        providerId: "sim.situation-data",
        providerLayerIds: ["traffic"],
        providerSourceIds: ["pid_gtfs_rt"],
        streamId: "features"
      },
      refreshSeconds: findSource(sources, "pid_gtfs_rt")?.updateCadenceSeconds ?? trafficLayer?.expectedCadenceSeconds ?? 60,
      role: "reference",
      selectable: true,
      styleProfile: "traffic-public-transit-v1"
    },
    ...buildInfrastructureLayers(groundLayer, sources)
  ];
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
      description: "Komunikační infrastruktura jako referenční kontext, ne stav mobilní sítě.",
      label: "Komunikační infrastruktura",
      layerId: "reference.infrastructure.communications",
      minZoom: 10,
      provenance: { sourceIds: ["sim.situation-data:osm_postgis"] },
      query: {
        ...infrastructureQuery(["communications_tower"]),
        providerLayerIds: ["mobile"]
      },
      selectable: false,
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
    feedsCatalogLayerIds: source.sourceId === "chmi_alerts"
      ? ["public.safety.warnings"]
      : source.sourceId === "chmi_hydro"
        ? ["public.safety.flood"]
        : source.sourceId === "fire_hotspots" || source.sourceId === "fire_incidents"
          ? ["public.safety.fire"]
          : source.sourceId === "weather_alerts"
            ? ["public.safety.weather_alerts"]
            : undefined,
    label: source.label ?? source.sourceId,
    providerId: "sim.safety-data",
    selectableInMap: source.enabled !== false && source.sourceId !== "mock",
    sourceId: source.sourceId,
    sourceRole: source.sourceId === "mock" ? "mock" : "final",
    updateCadenceSeconds: source.updateCadenceSeconds,
    visibleInDiagnostics: true
  }));
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
      return { audience: "public", feedsCatalogLayerIds: ["public.weather.current"], selectableInMap: true, sourceRole: "final" };
    case "aviation_weather":
      return { audience: "public", feedsCatalogLayerIds: ["public.weather.aviation"], selectableInMap: true, sourceRole: "final" };
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

function findSource<T extends { sourceId: string }>(sources: T[], sourceId: string): T | undefined {
  return sources.find((source) => source.sourceId === sourceId);
}

function nonEmpty<T>(value: T[] | undefined): T[] | undefined {
  return value && value.length > 0 ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function dedupeLayers(layers: MapCatalogLayer[]): MapCatalogLayer[] {
  const byId = new Map<string, MapCatalogLayer>();
  layers.forEach((layer) => {
    if (!byId.has(layer.layerId)) {
      byId.set(layer.layerId, layer);
    }
  });
  return Array.from(byId.values());
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
