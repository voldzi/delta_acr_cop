const preferencesKey = "cop.user.preferences.v1";

export interface MapViewState {
  center: [number, number];
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export type MapSymbolMode = "civil" | "standard";
// Stored under the legacy key for profile compatibility; semantically this is now the whole-map symbol mode.
export type PublicFlightSymbolMode = MapSymbolMode;
export type AppLanguage = "cs" | "en";
export type MapBasemapMode = "standard" | "civil" | "risk" | "dark" | "outline";
export type TrackHistoryDisplayMode = "all" | "selected";
export type WorkspacePanelMode = "open" | "collapsed" | "hidden";

export interface OperatorProfilePreferences {
  avatarDataUrl?: string;
  contactNote?: string;
  displayName?: string;
  email?: string;
  organization?: string;
  phone?: string;
  publicContact?: boolean;
  role?: string;
}

export interface WorkspaceLayoutPreferences {
  contextRailVisible?: boolean;
  leftPanelMode?: WorkspacePanelMode;
  leftPanelWidth?: number;
  rightPanelMode?: WorkspacePanelMode;
  rightPanelWidth?: number;
  statusbarVisible?: boolean;
}

export interface UserPreferences {
  activeWorkspace?: string;
  affiliationScope?: string;
  alertRadiusKm?: number;
  autoFit?: boolean;
  autoRefresh?: boolean;
  catalogLayerIds?: string[];
  domainScope?: string;
  includeSynthetic?: boolean;
  language?: AppLanguage;
  mapClusterEnabled?: boolean;
  mapBasemapMode?: MapBasemapMode;
  mapView?: MapViewState;
  minConfidence?: number;
  operatorProfile?: OperatorProfilePreferences;
  predictionMinutes?: number;
  predictionMode?: string;
  proximityAlertEnabled?: boolean;
  publicFlightSymbolMode?: PublicFlightSymbolMode;
  refreshSeconds?: number;
  safetyLayerIds?: string[];
  selectedLayer?: string;
  situationCoverageTechnology?: string;
  showAlertAreas?: boolean;
  showHistory?: boolean;
  showPrediction?: boolean;
  situationLayerIds?: string[];
  situationSourceIds?: string[];
  takLayerIds?: string[];
  trackLayerIds?: string[];
  trackHistoryDisplayMode?: TrackHistoryDisplayMode;
  trackHistoryLimit?: number;
  trackHistoryWindowSeconds?: number;
  workspaceLayout?: WorkspaceLayoutPreferences;
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
    catalogLayerIds: optionalStringArray(value.catalogLayerIds),
    domainScope: optionalString(value.domainScope),
    includeSynthetic: optionalBoolean(value.includeSynthetic),
    language: optionalAppLanguage(value.language),
    mapClusterEnabled: optionalBoolean(value.mapClusterEnabled),
    mapBasemapMode: optionalMapBasemapMode(value.mapBasemapMode),
    mapView: normalizeMapView(value.mapView),
    minConfidence: optionalFiniteNumber(value.minConfidence),
    operatorProfile: normalizeOperatorProfilePreferences(value.operatorProfile),
    predictionMinutes: optionalFiniteNumber(value.predictionMinutes),
    predictionMode: optionalString(value.predictionMode),
    proximityAlertEnabled: optionalBoolean(value.proximityAlertEnabled),
    publicFlightSymbolMode: optionalPublicFlightSymbolMode(value.publicFlightSymbolMode),
    refreshSeconds: optionalFiniteNumber(value.refreshSeconds),
    safetyLayerIds: optionalStringArray(value.safetyLayerIds),
    selectedLayer: optionalString(value.selectedLayer),
    situationCoverageTechnology: optionalString(value.situationCoverageTechnology),
    showAlertAreas: optionalBoolean(value.showAlertAreas),
    showHistory: optionalBoolean(value.showHistory),
    showPrediction: optionalBoolean(value.showPrediction),
    situationLayerIds: optionalStringArray(value.situationLayerIds),
    situationSourceIds: optionalStringArray(value.situationSourceIds),
    takLayerIds: optionalStringArray(value.takLayerIds),
    trackLayerIds: optionalStringArray(value.trackLayerIds),
    trackHistoryDisplayMode: optionalTrackHistoryDisplayMode(value.trackHistoryDisplayMode),
    trackHistoryLimit: optionalFiniteNumber(value.trackHistoryLimit),
    trackHistoryWindowSeconds: optionalFiniteNumber(value.trackHistoryWindowSeconds),
    workspaceLayout: normalizeWorkspaceLayoutPreferences(value.workspaceLayout)
  };
}

export function normalizeOperatorProfilePreferences(value: unknown): OperatorProfilePreferences | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const profile: OperatorProfilePreferences = {
    avatarDataUrl: optionalDataUrl(value.avatarDataUrl),
    contactNote: optionalTrimmedString(value.contactNote, 280),
    displayName: optionalTrimmedString(value.displayName, 80),
    email: optionalTrimmedString(value.email, 120),
    organization: optionalTrimmedString(value.organization, 120),
    phone: optionalTrimmedString(value.phone, 40),
    publicContact: optionalBoolean(value.publicContact),
    role: optionalTrimmedString(value.role, 80)
  };
  return compactObject(profile);
}

export function normalizeWorkspaceLayoutPreferences(value: unknown): WorkspaceLayoutPreferences | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const layout: WorkspaceLayoutPreferences = {
    contextRailVisible: optionalBoolean(value.contextRailVisible),
    leftPanelMode: optionalWorkspacePanelMode(value.leftPanelMode),
    leftPanelWidth: optionalClampedNumber(value.leftPanelWidth, 220, 460),
    rightPanelMode: optionalWorkspacePanelMode(value.rightPanelMode),
    rightPanelWidth: optionalClampedNumber(value.rightPanelWidth, 280, 560),
    statusbarVisible: optionalBoolean(value.statusbarVisible)
  };
  return compactObject(layout);
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

function optionalTrimmedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function optionalClampedNumber(value: unknown, min: number, max: number): number | undefined {
  const numberValue = optionalFiniteNumber(value);
  return numberValue === undefined ? undefined : clamp(numberValue, min, max);
}

function optionalDataUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/iu.test(value) && value.length <= 250_000
    ? value
    : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function optionalPublicFlightSymbolMode(value: unknown): PublicFlightSymbolMode | undefined {
  return value === "civil" || value === "standard" ? value : undefined;
}

function optionalMapBasemapMode(value: unknown): MapBasemapMode | undefined {
  return value === "standard" || value === "civil" || value === "risk" || value === "dark" || value === "outline" ? value : undefined;
}

function optionalAppLanguage(value: unknown): AppLanguage | undefined {
  return value === "en" || value === "cs" ? value : undefined;
}

function optionalTrackHistoryDisplayMode(value: unknown): TrackHistoryDisplayMode | undefined {
  return value === "all" || value === "selected" ? value : undefined;
}

function optionalWorkspacePanelMode(value: unknown): WorkspacePanelMode | undefined {
  return value === "open" || value === "collapsed" || value === "hidden" ? value : undefined;
}

function compactObject<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) as T : undefined;
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
