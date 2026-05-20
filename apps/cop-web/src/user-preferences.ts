const preferencesKey = "cop.user.preferences.v1";

export interface MapViewState {
  center: [number, number];
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface UserPreferences {
  activeWorkspace?: string;
  affiliationScope?: string;
  alertRadiusKm?: number;
  autoFit?: boolean;
  autoRefresh?: boolean;
  domainScope?: string;
  includeSynthetic?: boolean;
  mapClusterEnabled?: boolean;
  mapView?: MapViewState;
  minConfidence?: number;
  predictionMinutes?: number;
  predictionMode?: string;
  proximityAlertEnabled?: boolean;
  refreshSeconds?: number;
  selectedLayer?: string;
  showAlertAreas?: boolean;
  showHistory?: boolean;
  showPrediction?: boolean;
  situationLayerIds?: string[];
  trackLayerIds?: string[];
  trackHistoryLimit?: number;
  trackHistoryWindowSeconds?: number;
}

export function readUserPreferences(scope?: string): UserPreferences {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    if (typeof window.localStorage?.getItem !== "function") {
      return {};
    }
    const key = scopedStorageKey(preferencesKey, scope);
    const raw = window.localStorage.getItem(key) ?? (key === preferencesKey ? null : window.localStorage.getItem(preferencesKey));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? normalizeUserPreferences(parsed) : {};
  } catch {
    return {};
  }
}

export function writeUserPreferences(preferences: UserPreferences, scope?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  if (typeof window.localStorage?.setItem !== "function") {
    return;
  }
  window.localStorage.setItem(scopedStorageKey(preferencesKey, scope), JSON.stringify(preferences));
}

export function normalizeMapView(value: unknown): MapViewState | undefined {
  if (!isRecord(value) || !Array.isArray(value.center) || value.center.length !== 2) {
    return undefined;
  }
  const lon = Number(value.center[0]);
  const lat = Number(value.center[1]);
  const zoom = Number(value.zoom);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(zoom)) {
    return undefined;
  }
  return {
    center: [lon, lat],
    zoom: clamp(zoom, 0, 22),
    bearing: optionalFiniteNumber(value.bearing),
    pitch: optionalFiniteNumber(value.pitch)
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeUserPreferences(value: Record<string, unknown>): UserPreferences {
  return {
    activeWorkspace: optionalString(value.activeWorkspace),
    affiliationScope: optionalString(value.affiliationScope),
    alertRadiusKm: optionalFiniteNumber(value.alertRadiusKm),
    autoFit: optionalBoolean(value.autoFit),
    autoRefresh: optionalBoolean(value.autoRefresh),
    domainScope: optionalString(value.domainScope),
    includeSynthetic: optionalBoolean(value.includeSynthetic),
    mapClusterEnabled: optionalBoolean(value.mapClusterEnabled),
    mapView: normalizeMapView(value.mapView),
    minConfidence: optionalFiniteNumber(value.minConfidence),
    predictionMinutes: optionalFiniteNumber(value.predictionMinutes),
    predictionMode: optionalString(value.predictionMode),
    proximityAlertEnabled: optionalBoolean(value.proximityAlertEnabled),
    refreshSeconds: optionalFiniteNumber(value.refreshSeconds),
    selectedLayer: optionalString(value.selectedLayer),
    showAlertAreas: optionalBoolean(value.showAlertAreas),
    showHistory: optionalBoolean(value.showHistory),
    showPrediction: optionalBoolean(value.showPrediction),
    situationLayerIds: optionalStringArray(value.situationLayerIds),
    trackLayerIds: optionalStringArray(value.trackLayerIds),
    trackHistoryLimit: optionalFiniteNumber(value.trackHistoryLimit),
    trackHistoryWindowSeconds: optionalFiniteNumber(value.trackHistoryWindowSeconds)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function scopedStorageKey(baseKey: string, scope: string | undefined): string {
  const normalizedScope = normalizeStorageScope(scope);
  return normalizedScope ? `${baseKey}.${normalizedScope}` : baseKey;
}

function normalizeStorageScope(scope: string | undefined): string {
  if (!scope) {
    return "";
  }
  return scope
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
