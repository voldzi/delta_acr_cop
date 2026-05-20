import type { CopLayer } from "./cop-data";
import type { PredictionMode } from "./track-history";
import { normalizeMapView, type MapViewState } from "./user-preferences";

const customProfilesKey = "cop.user.viewProfiles.v1";

export type WorkspaceModule = "map" | "data" | "sources" | "alerts" | "replay";

export interface ViewProfileSettings {
  activeWorkspace?: WorkspaceModule;
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
  predictionMode?: PredictionMode;
  proximityAlertEnabled?: boolean;
  refreshSeconds?: number;
  safetyLayerIds?: string[];
  selectedLayer?: CopLayer;
  showAlertAreas?: boolean;
  showHistory?: boolean;
  showPrediction?: boolean;
  situationLayerIds?: string[];
  trackLayerIds?: CopLayer[];
  trackHistoryLimit?: number;
  trackHistoryWindowSeconds?: number;
}

export interface ViewProfile {
  builtIn?: boolean;
  description: string;
  id: string;
  name: string;
  settings: ViewProfileSettings;
}

export const builtInViewProfiles: ViewProfile[] = [
  {
    builtIn: true,
    description: "Celkový letecký obraz se SIM daty a standardním filtrem.",
    id: "builtin-air-picture",
    name: "Air picture",
    settings: {
      activeWorkspace: "map",
      affiliationScope: "all",
      autoFit: true,
      autoRefresh: true,
      domainScope: "AIR",
      includeSynthetic: true,
      mapClusterEnabled: true,
      minConfidence: 0.2,
      refreshSeconds: 5,
      safetyLayerIds: ["warnings"],
      selectedLayer: "air-situation",
      trackLayerIds: ["air-situation"],
      showAlertAreas: false,
      showHistory: true,
      showPrediction: true,
      situationLayerIds: ["weather"],
      trackHistoryLimit: 120,
      trackHistoryWindowSeconds: 180
    }
  },
  {
    builtIn: true,
    description: "Sledování UAV s kratší historií a rychlejším refreshem.",
    id: "builtin-uav-watch",
    name: "UAV watch",
    settings: {
      activeWorkspace: "data",
      affiliationScope: "all",
      autoFit: true,
      autoRefresh: true,
      domainScope: "AIR",
      includeSynthetic: true,
      mapClusterEnabled: true,
      minConfidence: 0.2,
      refreshSeconds: 2,
      safetyLayerIds: ["warnings"],
      selectedLayer: "uav",
      trackLayerIds: ["uav"],
      showAlertAreas: false,
      showHistory: true,
      showPrediction: true,
      situationLayerIds: ["weather"],
      trackHistoryLimit: 72,
      trackHistoryWindowSeconds: 60
    }
  },
  {
    builtIn: true,
    description: "Samostatná vrstva veřejných letových dat s licenční atribucí a kratší historií.",
    id: "builtin-public-flights",
    name: "Public flights",
    settings: {
      activeWorkspace: "sources",
      affiliationScope: "all",
      autoFit: true,
      autoRefresh: true,
      domainScope: "AIR",
      includeSynthetic: true,
      mapClusterEnabled: true,
      minConfidence: 0,
      refreshSeconds: 5,
      safetyLayerIds: ["warnings", "flood"],
      selectedLayer: "public-flights",
      trackLayerIds: ["public-flights"],
      showAlertAreas: false,
      showHistory: true,
      showPrediction: true,
      situationLayerIds: ["weather", "traffic"],
      trackHistoryLimit: 120,
      trackHistoryWindowSeconds: 180
    }
  },
  {
    builtIn: true,
    description: "Kontrola kvality dat, nízké confidence a stáří stop.",
    id: "builtin-data-quality",
    name: "Data quality",
    settings: {
      activeWorkspace: "sources",
      affiliationScope: "all",
      autoRefresh: true,
      domainScope: "all",
      includeSynthetic: true,
      mapClusterEnabled: true,
      minConfidence: 0,
      refreshSeconds: 5,
      safetyLayerIds: ["warnings", "flood"],
      selectedLayer: "data-quality",
      trackLayerIds: ["data-quality"],
      showAlertAreas: true,
      showHistory: false,
      showPrediction: false,
      situationLayerIds: ["weather", "mobile"]
    }
  },
  {
    builtIn: true,
    description: "Analytický pohled pro replay a delší stopu objektů.",
    id: "builtin-replay-analysis",
    name: "Replay analysis",
    settings: {
      activeWorkspace: "replay",
      affiliationScope: "all",
      autoRefresh: false,
      domainScope: "all",
      includeSynthetic: true,
      mapClusterEnabled: false,
      minConfidence: 0.1,
      safetyLayerIds: ["warnings", "flood"],
      selectedLayer: "air-situation",
      trackLayerIds: ["air-situation"],
      showAlertAreas: true,
      showHistory: true,
      showPrediction: false,
      situationLayerIds: ["weather", "ground", "traffic"],
      trackHistoryLimit: 240,
      trackHistoryWindowSeconds: 600
    }
  }
];

export function readViewProfiles(scope?: string): ViewProfile[] {
  return [...builtInViewProfiles, ...readCustomViewProfiles(scope)];
}

export function readCustomViewProfiles(scope?: string): ViewProfile[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const key = scopedStorageKey(customProfilesKey, scope);
    const raw = window.localStorage?.getItem(key) ?? (key === customProfilesKey ? null : window.localStorage?.getItem(customProfilesKey));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((value) => {
      const profile = normalizeViewProfile(value);
      return profile ? [profile] : [];
    });
  } catch {
    return [];
  }
}

export function writeCustomViewProfiles(profiles: ViewProfile[], scope?: string): void {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return;
  }

  window.localStorage.setItem(scopedStorageKey(customProfilesKey, scope), JSON.stringify(profiles.filter((profile) => !profile.builtIn).slice(-12)));
}

export function normalizeWorkspaceModule(value: unknown, fallback: WorkspaceModule = "map"): WorkspaceModule {
  return value === "map" || value === "data" || value === "sources" || value === "alerts" || value === "replay" ? value : fallback;
}

function normalizeViewProfile(value: unknown): ViewProfile | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }

  return {
    description: typeof value.description === "string" ? value.description : "Uložený pohled operátora.",
    id: value.id,
    name: value.name,
    settings: normalizeProfileSettings(value.settings)
  };
}

function normalizeProfileSettings(value: unknown): ViewProfileSettings {
  if (!isRecord(value)) {
    return {};
  }

  return {
    activeWorkspace: normalizeOptionalWorkspaceModule(value.activeWorkspace),
    affiliationScope: optionalString(value.affiliationScope),
    alertRadiusKm: optionalNumber(value.alertRadiusKm),
    autoFit: optionalBoolean(value.autoFit),
    autoRefresh: optionalBoolean(value.autoRefresh),
    domainScope: optionalString(value.domainScope),
    includeSynthetic: optionalBoolean(value.includeSynthetic),
    mapClusterEnabled: optionalBoolean(value.mapClusterEnabled),
    mapView: normalizeMapView(value.mapView),
    minConfidence: optionalNumber(value.minConfidence),
    predictionMinutes: optionalNumber(value.predictionMinutes),
    predictionMode: normalizePredictionMode(value.predictionMode),
    proximityAlertEnabled: optionalBoolean(value.proximityAlertEnabled),
    refreshSeconds: optionalNumber(value.refreshSeconds),
    safetyLayerIds: optionalStringArray(value.safetyLayerIds),
    selectedLayer: normalizeLayer(value.selectedLayer),
    showAlertAreas: optionalBoolean(value.showAlertAreas),
    showHistory: optionalBoolean(value.showHistory),
    showPrediction: optionalBoolean(value.showPrediction),
    situationLayerIds: optionalStringArray(value.situationLayerIds),
    trackLayerIds: optionalLayerArray(value.trackLayerIds),
    trackHistoryLimit: optionalNumber(value.trackHistoryLimit),
    trackHistoryWindowSeconds: optionalNumber(value.trackHistoryWindowSeconds)
  };
}

function normalizeLayer(value: unknown): CopLayer | undefined {
  return value === "air-situation" || value === "uav" || value === "friendly" || value === "foreign" || value === "public-flights" || value === "data-quality"
    ? value
    : undefined;
}

function optionalLayerArray(value: unknown): CopLayer[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const layers = value.filter((item): item is CopLayer => normalizeLayer(item) !== undefined);
  return layers.length > 0 ? Array.from(new Set(layers)) : [];
}

function normalizePredictionMode(value: unknown): PredictionMode | undefined {
  return value === "adaptive" || value === "telemetry" || value === "history" || value === "maneuver" ? value : undefined;
}

function normalizeOptionalWorkspaceModule(value: unknown): WorkspaceModule | undefined {
  return value === "map" || value === "data" || value === "sources" || value === "alerts" || value === "replay" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
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
