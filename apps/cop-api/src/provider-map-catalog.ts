export interface ProviderMapCatalog {
  contractVersion: "provider-map-catalog-v1";
  generatedAt?: string;
  layers: ProviderCatalogLayer[];
  providerId: string;
  sources: ProviderCatalogSource[];
  status?: string;
  warnings: string[];
}

export interface ProviderCatalogLayer {
  audience?: string;
  cacheTtlSeconds?: number;
  categories?: string[];
  categoryPath?: string[];
  defaultVisible?: boolean;
  description?: string;
  filters?: ProviderCatalogFilter[];
  geometryTypes?: string[];
  kind?: string;
  label: string;
  legal?: {
    attribution?: string;
    notes?: string[];
  };
  maxZoom?: number;
  minZoom?: number;
  providerLayerId: string;
  query?: ProviderCatalogQuery;
  recommendedCatalogLayerId: string;
  refreshSeconds?: number;
  role?: string;
  selectable?: boolean;
  sourceIds?: string[];
  styleProfile?: string;
  technicalInputs?: string[];
}

export interface ProviderCatalogFilter {
  defaultValue?: unknown;
  filterId: string;
  label: string;
  type: string;
  values?: string[];
}

export interface ProviderCatalogQuery {
  categoryFilter?: string[];
  categoryIds?: string[];
  maxFeatures?: number;
  mode?: string;
  providerId?: string;
  providerLayerIds?: string[];
  providerSourceIds?: string[];
  streamId?: string;
}

export interface ProviderCatalogSource {
  audience?: string;
  cacheTtlSeconds?: number;
  enabled?: boolean;
  feedsCatalogLayerIds?: string[];
  feedsLayerIds?: string[];
  label?: string;
  layers?: string[];
  sourceId: string;
  sourceRole?: string;
  updateCadenceSeconds?: number;
  usedByCatalogLayerIds?: string[];
  visibleInDiagnostics?: boolean;
  selectableInMap?: boolean;
}

export function normalizeProviderMapCatalog(value: unknown, expectedProviderId?: string): ProviderMapCatalog {
  if (!isRecord(value) || value.contractVersion !== "provider-map-catalog-v1") {
    throw new Error("Provider catalog response does not match provider-map-catalog-v1.");
  }
  const providerId = optionalString(value.providerId);
  if (!providerId || (expectedProviderId && providerId !== expectedProviderId)) {
    throw new Error(`Provider catalog id is invalid${expectedProviderId ? ` for ${expectedProviderId}` : ""}.`);
  }
  return {
    contractVersion: "provider-map-catalog-v1",
    generatedAt: optionalString(value.generatedAt),
    layers: Array.isArray(value.layers) ? value.layers.flatMap(normalizeProviderCatalogLayer) : [],
    providerId,
    sources: Array.isArray(value.sources) ? value.sources.flatMap(normalizeProviderCatalogSource) : [],
    status: optionalString(value.status),
    warnings: stringList(value.warnings)
  };
}

function normalizeProviderCatalogLayer(value: unknown): ProviderCatalogLayer[] {
  if (!isRecord(value)) {
    return [];
  }
  const providerLayerId = optionalString(value.providerLayerId);
  const recommendedCatalogLayerId = optionalString(value.recommendedCatalogLayerId);
  const label = optionalString(value.label);
  if (!providerLayerId || !recommendedCatalogLayerId || !label) {
    return [];
  }
  return [
    {
      audience: optionalString(value.audience),
      cacheTtlSeconds: optionalNumber(value.cacheTtlSeconds),
      categories: stringList(value.categories),
      categoryPath: stringList(value.categoryPath),
      defaultVisible: value.defaultVisible === true,
      description: optionalString(value.description),
      filters: Array.isArray(value.filters) ? value.filters.flatMap(normalizeProviderCatalogFilter) : undefined,
      geometryTypes: stringList(value.geometryTypes),
      kind: optionalString(value.kind),
      label,
      legal: normalizeLegal(value.legal),
      maxZoom: optionalNumber(value.maxZoom),
      minZoom: optionalNumber(value.minZoom),
      providerLayerId,
      query: normalizeProviderCatalogQuery(value.query),
      recommendedCatalogLayerId,
      refreshSeconds: optionalNumber(value.refreshSeconds),
      role: optionalString(value.role),
      selectable: value.selectable === true,
      sourceIds: stringList(value.sourceIds),
      styleProfile: optionalString(value.styleProfile),
      technicalInputs: stringList(value.technicalInputs)
    }
  ];
}

function normalizeProviderCatalogFilter(value: unknown): ProviderCatalogFilter[] {
  if (!isRecord(value)) {
    return [];
  }
  const filterId = optionalString(value.filterId);
  const label = optionalString(value.label);
  const type = optionalString(value.type);
  if (!filterId || !label || !type) {
    return [];
  }
  return [
    {
      defaultValue: value.defaultValue,
      filterId,
      label,
      type,
      values: stringList(value.values)
    }
  ];
}

function normalizeProviderCatalogQuery(value: unknown): ProviderCatalogQuery | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    categoryFilter: stringList(value.categoryFilter),
    categoryIds: stringList(value.categoryIds),
    maxFeatures: optionalNumber(value.maxFeatures),
    mode: optionalString(value.mode),
    providerId: optionalString(value.providerId),
    providerLayerIds: stringList(value.providerLayerIds),
    providerSourceIds: stringList(value.providerSourceIds),
    streamId: optionalString(value.streamId)
  };
}

function normalizeProviderCatalogSource(value: unknown): ProviderCatalogSource[] {
  if (!isRecord(value)) {
    return [];
  }
  const sourceId = optionalString(value.sourceId);
  if (!sourceId) {
    return [];
  }
  return [
    {
      audience: optionalString(value.audience),
      cacheTtlSeconds: optionalNumber(value.cacheTtlSeconds),
      enabled: value.enabled === true,
      feedsCatalogLayerIds: stringList(value.feedsCatalogLayerIds),
      feedsLayerIds: stringList(value.feedsLayerIds),
      label: optionalString(value.label),
      layers: stringList(value.layers),
      sourceId,
      sourceRole: optionalString(value.sourceRole),
      updateCadenceSeconds: optionalNumber(value.updateCadenceSeconds),
      usedByCatalogLayerIds: stringList(value.usedByCatalogLayerIds),
      visibleInDiagnostics: value.visibleInDiagnostics === true,
      selectableInMap: value.selectableInMap === true
    }
  ];
}

function normalizeLegal(value: unknown): ProviderCatalogLayer["legal"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const attribution = optionalString(value.attribution);
  const notes = stringList(value.notes);
  return attribution || notes.length > 0 ? { ...(attribution ? { attribution } : {}), notes } : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
