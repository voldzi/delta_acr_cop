import React from "react";
import { createRoot } from "react-dom/client";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState
} from "@tanstack/react-table";
import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  Bot,
  Building2,
  Bus,
  Clock3,
  CloudSun,
  Database,
  Gauge,
  History,
  Layers,
  ListFilter,
  LogIn,
  LogOut,
  MapPin,
  MessageCircle,
  MousePointer2,
  Move,
  Pause,
  Pin,
  PinOff,
  Plane,
  Play,
  Plus,
  RefreshCw,
  RadioTower,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserCircle,
  X,
  Wifi
} from "lucide-react";
import {
  beginLogin,
  createInitialAuthSession,
  endSession,
  getAuthorizationToken,
  initializeAuth,
  isAuthSessionActive,
  isOidcEnabled,
  readAuthConfig,
  type AuthConfig,
  type AuthSession
} from "./auth";
import {
  acknowledgeCopAlert,
  connectCopStream,
  createCommunityAttachmentUpload,
  createCommunityGroup,
  createCommunityReport,
  createMessagingConversation,
  bindMessagingConversationMatrixRoom,
  deleteCommunityReport,
  fetchCopDashboardData,
  fetchCopAlerts,
  fetchCommunityGroups,
  fetchMapCatalog,
  fetchMapFeatures,
  fetchMessagingConversations,
  fetchMessagingStatus,
  fetchPlaceGeocode,
  fetchUserProfile,
  resolveMessagingMatrixIdentities,
  syncMessagingConversationMembers,
  filterObjectsByLayers,
  filterVisibleObjects,
  copLayerIds,
  getDataQualityCount,
  getPublicFlightCount,
  getSimulatedAirCount,
  getUavCount,
  isPublicFlightObject,
  saveUserProfile,
  submitCommunityReport,
  updateCommunityReport,
  upsertCommunityGroupMember,
  uploadCommunityAttachmentFile,
  type CopDashboardData,
  type AoiRule,
  type AlertPreferences,
  type CopStreamMessage,
  type CopStreamStatus,
  type CopAlert,
  type CopLayer,
  type CopObject,
  type CopStreamHealth,
  type CommunityAttachmentKind,
  type CommunityAttachmentUploadProgress,
  type CommunityFeatureCollectionResponse,
  type CommunityGroup,
  type CommunityReportCategory,
  type CommunityReportHazardSeverity,
  type CommunityReportLocation,
  type CommunityMediaAccessMode,
  type CommunityMediaAccessPolicy,
  type CommunityVideoSpatialMode,
  type FlightDataAttributes,
  type FlightReferenceFeatureCollectionResponse,
  type HealthStatus,
  type MapCatalogLayer,
  type MapCatalogResponse,
  type MapCatalogSource,
  type MapBounds,
  type MessagingConversationSummary,
  type MessagingStatusResponse,
  type MissionArenaFeatureCollectionResponse,
  type ObjectProvenance,
  type PlaceGeocodeResult,
  type SourceHealthItem,
  type SourceSystem,
  type SafetyDataSourceId,
  type SafetyConfigResponse,
  type SafetyFeature,
  type SafetyFeatureCollectionResponse,
  type SafetyLayer,
  type SafetyLayerId,
  type SafetySourceDescriptor,
  type SituationFeature,
  type SituationFeatureCollectionResponse,
  type SituationLayer,
  type SituationLayerId,
  type SituationSourceDescriptor,
  type TakFeature,
  type TakFeatureCollectionResponse,
  type TakLayer,
  type TakLayerId,
  type TakSourceDescriptor
} from "./cop-data";
import { CopMap, formatTrackLabel } from "./CopMap";
import { MessagingPanel } from "./messaging/MessagingPanel";
import { buildObjectDetailModel, type ConfidenceFactor, type LineageStep, type ObjectConflict, type ObjectHistoryEntry } from "./object-detail";
import { buildProximityAlerts, type ProximityAlert, type UserLocation } from "./proximity-alerts";
import {
  createInitialStreamTelemetry,
  formatStreamLatency,
  formatStreamObservation,
  updateStreamTelemetryForError,
  updateStreamTelemetryForMessage,
  type StreamTelemetry
} from "./stream-observability";
import { getAffiliationPresentation } from "./symbology";
import {
  normalizeRefreshSeconds,
  parseRefreshSeconds,
  refreshMillisecondsToSeconds,
  REFRESH_OPTIONS,
  type RefreshSeconds
} from "./refresh-config";
import { buildMapSearchResults, buildPlaceSearchResults, type MapSearchResult } from "./map-search";
import {
  countHistoryPoints,
  getReplayTimestamp,
  getReplayWindow,
  mergeTrackHistory,
  selectReplayObjects,
  trimHistoryToTimestamp,
  trimTrackHistory,
  type PredictionMode,
  type ReplayWindow,
  type TrackHistory
} from "./track-history";
import { ModalDialog } from "./ui/dialog";
import { SelectField } from "./ui/select";
import { Tooltip } from "./ui/tooltip";
import {
  clamp,
  normalizeMapView,
  normalizeUserPreferences,
  readUserPreferences,
  writeUserPreferences,
  type MapBasemapMode,
  type MapViewState,
  type PublicFlightSymbolMode,
  type TrackHistoryDisplayMode,
  type UserPreferences
} from "./user-preferences";
import {
  builtInViewProfiles,
  normalizeWorkspaceModule,
  readViewProfiles,
  writeCustomViewProfiles,
  type ViewProfile,
  type ViewProfileSettings,
  type WorkspaceModule
} from "./view-profiles";
import {
  readCopOfflineSnapshot,
  registerCopServiceWorker,
  snapshotAgeSeconds,
  writeCopOfflineSnapshot,
  type CopOfflineSnapshot
} from "./pwa-offline";
import {
  filterCitizenSituationLayers,
  filterCitizenSituationSources,
  filterTechnicalSituationSources,
  normalizeCitizenSituationLayerIds,
  sanitizeCitizenSituationSourceIds
} from "./situation-source-policy";
import {
  formatMobileNetworkSourceRevision,
  mobileNetworkBasisLabels,
  mobileNetworkBtsStatusNotice,
  mobileNetworkDataQualityLabel,
  mobileNetworkModelLabel
} from "./mobile-network-provenance";
import {
  formatTransportCurrentStatus,
  formatTransportDelay,
  formatTransportHeading,
  formatTransportOccupancy,
  formatTransportSpeed,
  resolveTransportPresentation
} from "./transport-presentation";
import "./styles.css";

const apiBase = import.meta.env.VITE_COP_API_BASE_URL ?? "";
const labToken = import.meta.env.VITE_COP_PUBLIC_LAB_VALUE ?? (import.meta.env.DEV ? "dev-lab-token" : "");
const defaultRefreshSeconds = refreshMillisecondsToSeconds(import.meta.env.VITE_COP_REFRESH_MS ?? "5000");
const messagingLauncherEnabled = readBooleanEnv(import.meta.env.VITE_COP_MESSAGING_LAUNCHER_ENABLED ?? "true");
const XrWorkspace = React.lazy(() => import("./XrWorkspace"));

type AffiliationScope = "all" | "friend" | "hostile" | "neutral" | "unknown";
type DomainScope = "all" | "AIR" | "LAND" | "SEA" | "RESCUE" | "OTHER";
type OperatingMode = "DEGRADED" | "OFFLINE" | "ONLINE";
type OfflineSnapshotState =
  | { kind: "active"; objectCount: number; reason: string; restoredAt: string; savedAt: string; sourceCount: number }
  | { kind: "available"; objectCount: number; savedAt: string; sourceCount: number }
  | { kind: "none" };
type PreferenceSettings = ViewProfileSettings | UserPreferences;
type SettingsTab = "map" | "data" | "awareness" | "account";
type LoginPromptReason = "account" | "ai" | "alert" | "chat" | "profile" | "report";
type ProfileSyncStatus = "disabled" | "error" | "loading" | "saving" | "synced";
type SituationLayerStatus = "disabled" | "loading" | "online" | "degraded" | "zoom";
type CoverageTechnology = "2G" | "4G" | "5G";
interface CatalogGroupView {
  group: MapCatalogResponse["groups"][number];
  layers: MapCatalogLayer[];
}

const historyLimitOptions = [36, 72, 120, 240, 600] as const;
const historyWindowOptions = [30, 60, 120, 180, 300, 600] as const;
const coverageTechnologyOptions: CoverageTechnology[] = ["2G", "4G", "5G"];
const mapBasemapModeOptions: Array<[MapBasemapMode, string]> = [
  ["standard", "OSM"],
  ["civil", "Civilní"],
  ["risk", "Rizika"],
  ["dark", "Tmavá"]
];
const defaultSituationLayerIds: SituationLayerId[] = ["weather"];
const defaultSafetyLayerIds: SafetyLayerId[] = ["warnings"];
const defaultTakLayerIds: TakLayerId[] = [];
const zoneColorOptions = ["#8cb6d8", "#c8f08d", "#facc15", "#fb923c", "#ef4444", "#a78bfa"] as const;
const predictionModeOptions: Array<[PredictionMode, string]> = [
  ["adaptive", "Adaptivní"],
  ["telemetry", "Telemetrie"],
  ["history", "Trend"],
  ["maneuver", "Manévr"]
];
const defaultAoiCenter = { lat: 50.0755, lon: 14.4378 };

interface DashboardMetrics {
  activeSources: number;
  avgConfidence: number;
  foreignCount: number;
  friendlyCount: number;
  lowConfidenceCount: number;
  publicFlightCount: number;
  syntheticCount: number;
  warningCount: number;
}

interface AlertSummary {
  critical: number;
  local: number;
  server: number;
  total: number;
  warning: number;
}

export function App() {
  const authConfig = React.useMemo(() => readAuthConfig(), []);
  const [authSession, setAuthSession] = React.useState<AuthSession>(() => createInitialAuthSession(authConfig));
  const userStorageScope = React.useMemo(
    () => userPreferenceScope(authSession),
    [authSession.profile?.subjectId, authSession.profile?.username, authSession.status]
  );
  const [offlineSnapshotState, setOfflineSnapshotState] = React.useState<OfflineSnapshotState>(() =>
    initialOfflineSnapshotState(userStorageScope)
  );
  const initialPreferences = React.useMemo(() => readUserPreferences(userStorageScope), [userStorageScope]);
  const [activeWorkspace, setActiveWorkspace] = React.useState<WorkspaceModule>(() =>
    normalizeWorkspaceModule(initialPreferences.activeWorkspace)
  );
  const [health, setHealth] = React.useState<HealthStatus | null>(null);
  const [sources, setSources] = React.useState<SourceSystem[]>([]);
  const [sourceHealth, setSourceHealth] = React.useState<SourceHealthItem[]>([]);
  const [streamHealth, setStreamHealth] = React.useState<CopStreamHealth | null>(null);
  const [serverAlerts, setServerAlerts] = React.useState<CopAlert[]>([]);
  const [objects, setObjects] = React.useState<CopObject[]>([]);
  const [selectedLayer, setSelectedLayer] = React.useState<CopLayer>(() => readInitialLayer(initialPreferences.selectedLayer));
  const [visibleTrackLayerIds, setVisibleTrackLayerIds] = React.useState<CopLayer[]>(() =>
    normalizeTrackLayerIds(initialPreferences.trackLayerIds, readInitialLayer(initialPreferences.selectedLayer))
  );
  const [selectedObjectId, setSelectedObjectId] = React.useState<string | null>(null);
  const [includeSynthetic, setIncludeSynthetic] = React.useState(initialPreferences.includeSynthetic ?? true);
  const [minConfidence, setMinConfidence] = React.useState(() => clamp(initialPreferences.minConfidence ?? 0.2, 0, 1));
  const [affiliationScope, setAffiliationScope] = React.useState<AffiliationScope>(() =>
    readInitialAffiliationScope(initialPreferences.affiliationScope)
  );
  const [domainScope, setDomainScope] = React.useState<DomainScope>(() => readInitialDomainScope(initialPreferences.domainScope));
  const [searchQuery, setSearchQuery] = React.useState("");
  const [mapSearchQuery, setMapSearchQuery] = React.useState("");
  const [mapSearchDocked, setMapSearchDocked] = React.useState(() => readMapSearchDocked());
  const [placeSearchItems, setPlaceSearchItems] = React.useState<PlaceGeocodeResult[]>([]);
  const [placeSearchLoading, setPlaceSearchLoading] = React.useState(false);
  const [placeSearchError, setPlaceSearchError] = React.useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = React.useState<string | null>(null);
  const [, setLastStreamAt] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [streamStatus, setStreamStatus] = React.useState<CopStreamStatus>("connecting");
  const [streamTelemetry, setStreamTelemetry] = React.useState<StreamTelemetry>(() => createInitialStreamTelemetry());
  const [streamReconnectAttempt, setStreamReconnectAttempt] = React.useState(0);
  const [browserOnline, setBrowserOnline] = React.useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [autoRefresh, setAutoRefresh] = React.useState(() => readInitialAutoRefresh(initialPreferences.autoRefresh));
  const [refreshSeconds, setRefreshSeconds] = React.useState<RefreshSeconds>(() =>
    readInitialRefreshSeconds(normalizeRefreshSeconds(initialPreferences.refreshSeconds ?? defaultRefreshSeconds))
  );
  const [replayRunning, setReplayRunning] = React.useState(false);
  const [replayPosition, setReplayPosition] = React.useState(100);
  const [showHistory, setShowHistory] = React.useState(() => readInitialMapToggle("history", initialPreferences.showHistory ?? false));
  const [showPrediction, setShowPrediction] = React.useState(() =>
    readInitialMapToggle("prediction", initialPreferences.showPrediction ?? false)
  );
  const [trackHistoryDisplayMode, setTrackHistoryDisplayMode] = React.useState<TrackHistoryDisplayMode>(() =>
    normalizeTrackHistoryDisplayMode(initialPreferences.trackHistoryDisplayMode)
  );
  const [publicFlightSymbolMode, setPublicFlightSymbolMode] = React.useState<PublicFlightSymbolMode>(() =>
    normalizePublicFlightSymbolMode(initialPreferences.publicFlightSymbolMode)
  );
  const [mapClusterEnabled, setMapClusterEnabled] = React.useState(initialPreferences.mapClusterEnabled ?? false);
  const [mapBasemapMode, setMapBasemapMode] = React.useState<MapBasemapMode>(() =>
    normalizeMapBasemapMode(initialPreferences.mapBasemapMode)
  );
  const [showAlertAreas, setShowAlertAreas] = React.useState(initialPreferences.showAlertAreas ?? false);
  const [predictionMinutes, setPredictionMinutes] = React.useState(() => clamp(initialPreferences.predictionMinutes ?? 10, 2, 20));
  const [predictionMode, setPredictionMode] = React.useState<PredictionMode>(() => readInitialPredictionMode(initialPreferences.predictionMode));
  const [trackHistoryLimit, setTrackHistoryLimit] = React.useState(() => readInitialHistoryLimit(initialPreferences.trackHistoryLimit));
  const [trackHistoryWindowSeconds, setTrackHistoryWindowSeconds] = React.useState(() =>
    readInitialHistoryWindowSeconds(initialPreferences.trackHistoryWindowSeconds)
  );
  const [trackHistory, setTrackHistory] = React.useState<TrackHistory>({});
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>("map");
  const [activeCatalogGroupId, setActiveCatalogGroupId] = React.useState<string | null>(null);
  const [visibleCatalogLayerIds, setVisibleCatalogLayerIds] = React.useState<string[]>(() =>
    normalizeCatalogLayerIds(initialPreferences.catalogLayerIds)
  );
  const [zoneCreationMode, setZoneCreationMode] = React.useState(false);
  const [autoFit, setAutoFit] = React.useState(initialPreferences.autoFit ?? true);
  const [mapView, setMapView] = React.useState<MapViewState | undefined>(() => normalizeMapView(initialPreferences.mapView));
  const [mapBounds, setMapBounds] = React.useState<MapBounds | undefined>();
  const [focusViewRequest, setFocusViewRequest] = React.useState(0);
  const [mapCatalog, setMapCatalog] = React.useState<MapCatalogResponse | null>(null);
  const [situationLayers, setSituationLayers] = React.useState<SituationLayer[]>([]);
  const [situationSources, setSituationSources] = React.useState<SituationSourceDescriptor[]>([]);
  const [visibleSituationLayerIds, setVisibleSituationLayerIds] = React.useState<SituationLayerId[]>(() =>
    normalizeSituationLayerIds(initialPreferences.situationLayerIds)
  );
  const [visibleSituationSourceIds, setVisibleSituationSourceIds] = React.useState<string[]>(() =>
    normalizeSourceIds(initialPreferences.situationSourceIds)
  );
  const [coverageTechnology, setCoverageTechnology] = React.useState<CoverageTechnology>(() =>
    normalizeCoverageTechnology(initialPreferences.situationCoverageTechnology)
  );
  const [situationFeatures, setSituationFeatures] = React.useState<SituationFeatureCollectionResponse | null>(null);
  const [situationStatus, setSituationStatus] = React.useState<SituationLayerStatus>("loading");
  const [situationWarnings, setSituationWarnings] = React.useState<string[]>([]);
  const [safetyLayers, setSafetyLayers] = React.useState<SafetyLayer[]>([]);
  const [visibleSafetyLayerIds, setVisibleSafetyLayerIds] = React.useState<SafetyLayerId[]>(() =>
    normalizeSafetyLayerIds(initialPreferences.safetyLayerIds)
  );
  const [safetyFeatures, setSafetyFeatures] = React.useState<SafetyFeatureCollectionResponse | null>(null);
  const [safetyStatus, setSafetyStatus] = React.useState<SituationLayerStatus>("loading");
  const [safetyWarnings, setSafetyWarnings] = React.useState<string[]>([]);
  const [safetySources, setSafetySources] = React.useState<SafetySourceDescriptor[]>([]);
  const [safetyConfig, setSafetyConfig] = React.useState<SafetyConfigResponse | null>(null);
  const [flightFeatures, setFlightFeatures] = React.useState<FlightReferenceFeatureCollectionResponse | null>(null);
  const [flightStatus, setFlightStatus] = React.useState<SituationLayerStatus>("disabled");
  const [flightWarnings, setFlightWarnings] = React.useState<string[]>([]);
  const [communityFeatures, setCommunityFeatures] = React.useState<CommunityFeatureCollectionResponse | null>(null);
  const [communityStatus, setCommunityStatus] = React.useState<SituationLayerStatus>("online");
  const [communityWarnings, setCommunityWarnings] = React.useState<string[]>([]);
  const [missionArenaFeatures, setMissionArenaFeatures] = React.useState<MissionArenaFeatureCollectionResponse | null>(null);
  const [missionArenaStatus, setMissionArenaStatus] = React.useState<SituationLayerStatus>("disabled");
  const [missionArenaWarnings, setMissionArenaWarnings] = React.useState<string[]>([]);
  const [communityReportOpen, setCommunityReportOpen] = React.useState(false);
  const [communityReportDraft, setCommunityReportDraft] = React.useState<CommunityReportDraft>(() => createCommunityReportDraft());
  const [communityReportSubmitting, setCommunityReportSubmitting] = React.useState(false);
  const [communityReportError, setCommunityReportError] = React.useState<string | null>(null);
  const [communityReportSuccess, setCommunityReportSuccess] = React.useState<string | null>(null);
  const [communityUploadProgress, setCommunityUploadProgress] = React.useState<CommunityUploadUiState | null>(null);
  const [communityReportLocationPickMode, setCommunityReportLocationPickMode] = React.useState(false);
  const [communityRefreshNonce, setCommunityRefreshNonce] = React.useState(0);
  const [communityGroups, setCommunityGroups] = React.useState<CommunityGroup[]>([]);
  const [communityGroupsError, setCommunityGroupsError] = React.useState<string | null>(null);
  const [communityGallery, setCommunityGallery] = React.useState<CommunityGalleryState | null>(null);
  const [loginPromptReason, setLoginPromptReason] = React.useState<LoginPromptReason | null>(null);
  const [takLayers, setTakLayers] = React.useState<TakLayer[]>([]);
  const [visibleTakLayerIds, setVisibleTakLayerIds] = React.useState<TakLayerId[]>(() => normalizeTakLayerIds(initialPreferences.takLayerIds));
  const [takFeatures, setTakFeatures] = React.useState<TakFeatureCollectionResponse | null>(null);
  const [takStatus, setTakStatus] = React.useState<SituationLayerStatus>("disabled");
  const [takWarnings, setTakWarnings] = React.useState<string[]>([]);
  const [takSources, setTakSources] = React.useState<TakSourceDescriptor[]>([]);
  const [selectedSituationFeatureId, setSelectedSituationFeatureId] = React.useState<string | null>(null);
  const [userLocation, setUserLocation] = React.useState<UserLocation | null>(null);
  const [focusUserLocationRequest, setFocusUserLocationRequest] = React.useState(0);
  const [locationStatus, setLocationStatus] = React.useState("Poloha není zaměřená.");
  const [isLocating, setIsLocating] = React.useState(false);
  const [proximityAlertEnabled, setProximityAlertEnabled] = React.useState(initialPreferences.proximityAlertEnabled ?? false);
  const [alertRadiusKm, setAlertRadiusKm] = React.useState(() => clamp(initialPreferences.alertRadiusKm ?? 10, 1, 50));
  const [viewProfiles, setViewProfiles] = React.useState<ViewProfile[]>(() => readViewProfiles(userStorageScope));
  const [lastProfileName, setLastProfileName] = React.useState<string | null>(null);
  const [alertPreferences, setAlertPreferences] = React.useState<AlertPreferences>({});
  const [profileSyncStatus, setProfileSyncStatus] = React.useState<ProfileSyncStatus>("loading");
  const [profileSyncError, setProfileSyncError] = React.useState<string | null>(null);
  const [serverProfileUpdatedAt, setServerProfileUpdatedAt] = React.useState<string | null>(null);
  const [messagingOpen, setMessagingOpen] = React.useState(false);
  const [messagingPinned, setMessagingPinned] = React.useState(false);
  const [messagingStatus, setMessagingStatus] = React.useState<MessagingStatusResponse | null>(null);
  const [messagingLoading, setMessagingLoading] = React.useState(false);
  const [messagingError, setMessagingError] = React.useState<string | null>(null);
  const [messagingConversations, setMessagingConversations] = React.useState<MessagingConversationSummary[]>([]);
  const [messagingConversationsError, setMessagingConversationsError] = React.useState<string | null>(null);
  const [aiResult, setAiResult] = React.useState("Mock AI provider připraven pro dotazy nad situačními daty.");
  const loadInFlightRef = React.useRef(false);
  const catalogSelectionInitializedRef = React.useRef(initialPreferences.catalogLayerIds !== undefined);
  const profileHydratedRef = React.useRef(false);
  const profileLoadKeyRef = React.useRef<string | null>(null);
  const profileSaveTimerRef = React.useRef<number | undefined>(undefined);
  const skipNextPreferenceWriteRef = React.useRef(false);
  const notifiedProximityAlertsRef = React.useRef<Set<string>>(new Set());
  const authToken = getAuthorizationToken(authSession, labToken);
  const authenticatedSessionActive = isAuthSessionActive(authSession);
  const dataAccessReady = authConfig.publicReadEnabled || Boolean(authToken);
  const profileAccessReady = Boolean(authToken);
  const messagingAuthenticated = authenticatedSessionActive;

  React.useEffect(() => {
    if (authSession.status !== "authenticated" || !authSession.expiresAt || !isOidcEnabled(authConfig)) {
      return;
    }
    const refreshDelayMs = Math.max(0, authSession.expiresAt - Date.now() - 60_000);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      initializeAuth(authConfig)
        .then((nextSession) => {
          if (!cancelled) {
            setAuthSession(nextSession);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setAuthSession({
              error: error instanceof Error ? error.message : "Přihlášení vypršelo.",
              status: "anonymous"
            });
          }
        });
    }, refreshDelayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authConfig, authSession.expiresAt, authSession.status]);

  React.useEffect(() => {
    if (!communityReportSubmitting) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [communityReportSubmitting]);

  const applyDashboardData = React.useCallback((data: CopDashboardData, observedAt: Date) => {
    setHealth(data.health);
    setSources(data.sources);
    setSourceHealth(data.sourceHealth);
    setStreamHealth(data.streamHealth ?? null);
    setServerAlerts(data.alerts);
    setObjects(data.objects);
    setTrackHistory((current) =>
      data.trackHistory
        ? trimTrackHistory(data.trackHistory, trackHistoryLimit, trackHistoryWindowSeconds, observedAt.toISOString())
        : mergeTrackHistory(current, data.objects, observedAt.toISOString(), trackHistoryLimit, trackHistoryWindowSeconds)
    );
    setLastLoadedAt(observedAt.toLocaleTimeString("cs-CZ"));
  }, [trackHistoryLimit, trackHistoryWindowSeconds]);

  const persistOfflineSnapshot = React.useCallback((data: CopDashboardData, savedAt = new Date().toISOString()) => {
    const snapshot = writeCopOfflineSnapshot(data, userStorageScope, savedAt);
    if (!snapshot) {
      return;
    }
    setOfflineSnapshotState({
      kind: "available",
      objectCount: snapshot.objectCount,
      savedAt: snapshot.savedAt,
      sourceCount: snapshot.sourceCount
    });
  }, [userStorageScope]);

  React.useEffect(() => {
    if (!isOidcEnabled(authConfig)) {
      return;
    }

    setAuthSession((current) => current.status === "authenticated" ? current : { ...current, status: "authenticating" });
    initializeAuth(authConfig)
      .then(setAuthSession)
      .catch((error: unknown) => {
        setAuthSession({
          error: error instanceof Error ? error.message : "OIDC přihlášení selhalo.",
          status: "error"
        });
      });
  }, [authConfig]);

  const load = React.useCallback(async () => {
    if (!dataAccessReady) {
      setLoadError("Pro načtení situačních dat je potřeba přihlášení nebo zapnutý veřejný režim čtení.");
      return;
    }
    if (loadInFlightRef.current) {
      return;
    }
    loadInFlightRef.current = true;
    setIsLoading(true);
    try {
      const data = await fetchCopDashboardData(apiBase, authToken, {
        limit: trackHistoryLimit,
        seconds: trackHistoryWindowSeconds
      });
      const observedAt = new Date();
      applyDashboardData(data, observedAt);
      persistOfflineSnapshot(data, observedAt.toISOString());
      setLoadError(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Nepodařilo se načíst situační data.";
      const snapshot = readCopOfflineSnapshot(userStorageScope);
      if (snapshot) {
        const restoredAt = new Date();
        applyDashboardData(snapshot.data, restoredAt);
        setOfflineSnapshotState({
          kind: "active",
          objectCount: snapshot.objectCount,
          reason: errorMessage,
          restoredAt: restoredAt.toISOString(),
          savedAt: snapshot.savedAt,
          sourceCount: snapshot.sourceCount
        });
        setStreamStatus(browserOnline ? "degraded" : "offline");
        setLoadError(`${errorMessage}. Zobrazuji lokální read-only snapshot (${formatSnapshotAge(snapshot)}).`);
      } else {
        setLoadError(errorMessage);
      }
    } finally {
      loadInFlightRef.current = false;
      setIsLoading(false);
    }
  }, [applyDashboardData, authToken, browserOnline, dataAccessReady, persistOfflineSnapshot, trackHistoryLimit, trackHistoryWindowSeconds, userStorageScope]);

  const loadAlerts = React.useCallback(async () => {
    if (!authToken) {
      return;
    }
    try {
      setServerAlerts(await fetchCopAlerts(apiBase, authToken));
    } catch {
      // Main data loading already reports API errors; alert refresh should not obscure the current situation view.
    }
  }, [authToken]);

  const loadMessagingStatus = React.useCallback(async () => {
    setMessagingLoading(true);
    try {
      setMessagingStatus(await fetchMessagingStatus(apiBase, authToken));
      setMessagingError(null);
    } catch (error) {
      if (authToken && authConfig.publicReadEnabled && isUnauthorizedApiError(error)) {
        try {
          setMessagingStatus(await fetchMessagingStatus(apiBase, undefined));
          setMessagingError("Přihlášení pro zprávy vypršelo. Stav služby zobrazuji ve veřejném režimu.");
          setAuthSession((current) => current.status === "authenticated" ? { status: "anonymous" } : current);
          return;
        } catch {
          // Fall through to the regular degraded state below.
        }
      }
      setMessagingStatus(null);
      setMessagingError(error instanceof Error ? error.message : "Stav messaging služby není dostupný.");
    } finally {
      setMessagingLoading(false);
    }
  }, [apiBase, authConfig.publicReadEnabled, authToken]);

  const loadCommunityGroups = React.useCallback(async () => {
    if (!messagingAuthenticated || !authSession.accessToken) {
      setCommunityGroups([]);
      setCommunityGroupsError(null);
      setMessagingConversations([]);
      setMessagingConversationsError(null);
      return;
    }
    try {
      const [groupsResponse, conversationsResponse] = await Promise.all([
        fetchCommunityGroups(apiBase, authSession.accessToken),
        fetchMessagingConversations(apiBase, authSession.accessToken)
      ]);
      setCommunityGroups(groupsResponse.items);
      setMessagingConversations(conversationsResponse.conversations);
      setCommunityGroupsError(null);
      setMessagingConversationsError(conversationsResponse.status === "online" ? null : conversationsResponse.warnings[0] ?? "Konverzace nejsou plně dostupné.");
    } catch (error) {
      const message = isUnauthorizedApiError(error)
        ? "Přihlášení pro zprávy vypršelo. Přihlaste se znovu."
        : error instanceof Error ? error.message : "Konverzace nejsou dostupné.";
      if (isUnauthorizedApiError(error)) {
        setAuthSession((current) => current.status === "authenticated" ? { status: "anonymous" } : current);
      }
      setCommunityGroups([]);
      setMessagingConversations([]);
      setCommunityGroupsError(message);
      setMessagingConversationsError(message);
    }
  }, [apiBase, authSession.accessToken, messagingAuthenticated]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleOnline = () => {
      setBrowserOnline(true);
      setStreamReconnectAttempt((current) => current + 1);
    };
    const handleOffline = () => {
      setBrowserOnline(false);
      setStreamStatus("offline");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  React.useEffect(() => {
    if (!dataAccessReady) {
      setStreamStatus("offline");
      return;
    }
    if (!browserOnline) {
      setStreamStatus("offline");
      return;
    }

    let active = true;
    let reconnectTimer: number | undefined;
    let streamFlushTimer: number | undefined;
    const pendingStreamMessages: CopStreamMessage[] = [];
    const scheduleReconnect = () => {
      reconnectTimer = window.setTimeout(() => {
        if (active) {
          setStreamReconnectAttempt((current) => current + 1);
        }
      }, 5000);
    };
    const clearStreamFlushTimer = () => {
      if (streamFlushTimer !== undefined) {
        window.clearTimeout(streamFlushTimer);
        streamFlushTimer = undefined;
      }
    };
    const flushStreamMessages = () => {
      if (!active || pendingStreamMessages.length === 0) {
        clearStreamFlushTimer();
        return;
      }
      const messages = pendingStreamMessages.splice(0);
      clearStreamFlushTimer();
      setStreamTelemetry((current) =>
        messages.reduce((telemetry, message) => updateStreamTelemetryForMessage(telemetry, message), current)
      );
      applyCopStreamMessages(messages, {
        setLastLoadedAt,
        setLastStreamAt,
        setObjects,
        setStreamStatus,
        setTrackHistory,
        trackHistoryLimit,
        trackHistoryWindowSeconds
      });
    };
    const scheduleStreamFlush = (mode: "deferred" | "immediate" = "deferred") => {
      if (mode === "immediate") {
        flushStreamMessages();
        return;
      }
      if (streamFlushTimer !== undefined) {
        return;
      }
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      streamFlushTimer = window.setTimeout(flushStreamMessages, hidden ? 2500 : 750);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        flushStreamMessages();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    setStreamStatus("connecting");
    const connection = connectCopStream(apiBase, authToken, {
      onError: (error) => {
        if (active) {
          flushStreamMessages();
          setStreamTelemetry((current) => updateStreamTelemetryForError(current, error));
          setStreamStatus(browserOnline ? "degraded" : "offline");
          scheduleReconnect();
        }
      },
      onMessage: (message) => {
        if (!active) {
          return;
        }
        pendingStreamMessages.push(message);
        if (message.type === "reconnect_required") {
          scheduleStreamFlush("immediate");
          setStreamStatus("degraded");
          setStreamReconnectAttempt((current) => current + 1);
          return;
        }
        scheduleStreamFlush(message.type === "snapshot" || message.type === "backpressure" ? "immediate" : "deferred");
      },
      onOpen: () => {
        if (active) {
          setStreamStatus("live");
          setStreamTelemetry((current) => ({ ...current, lastError: null }));
        }
      }
    });
    if (!connection) {
      setStreamTelemetry((current) => updateStreamTelemetryForError(current, new Error("Readable stream is not available.")));
      setStreamStatus("degraded");
      scheduleReconnect();
      return () => {
        active = false;
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        clearStreamFlushTimer();
        pendingStreamMessages.length = 0;
        if (reconnectTimer !== undefined) {
          window.clearTimeout(reconnectTimer);
        }
      };
    }

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearStreamFlushTimer();
      pendingStreamMessages.length = 0;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      connection.close();
    };
  }, [authToken, browserOnline, dataAccessReady, streamReconnectAttempt, trackHistoryLimit, trackHistoryWindowSeconds]);

  React.useEffect(() => {
    if (!autoRefresh || streamStatus === "live" || streamStatus === "offline") {
      return;
    }
    const timer = window.setInterval(() => {
      void load();
    }, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load, refreshSeconds, streamStatus]);

  React.useEffect(() => {
    if (!authToken) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadAlerts();
    }, Math.max(refreshSeconds, 5) * 1000);
    return () => window.clearInterval(timer);
  }, [authToken, loadAlerts, refreshSeconds]);

  React.useEffect(() => {
    if (!messagingOpen) {
      return;
    }
    void loadMessagingStatus();
    void loadCommunityGroups();
  }, [loadCommunityGroups, loadMessagingStatus, messagingOpen]);

  React.useEffect(() => {
    if (!communityReportOpen) {
      return;
    }
    void loadCommunityGroups();
  }, [communityReportOpen, loadCommunityGroups]);

  React.useEffect(() => {
    if (!dataAccessReady) {
      setSituationStatus("disabled");
      setSituationWarnings(["Pro načtení situačních vrstev je potřeba přihlášení nebo zapnutý veřejný režim čtení."]);
      setSafetyStatus("disabled");
      setSafetyWarnings(["Pro načtení bezpečnostních vrstev je potřeba přihlášení nebo zapnutý veřejný režim čtení."]);
      setFlightStatus("disabled");
      setFlightWarnings(["Pro načtení leteckých referencí je potřeba přihlášení nebo zapnutý veřejný režim čtení."]);
      setCommunityStatus("disabled");
      setCommunityWarnings(["Pro načtení komunitních hlášení je potřeba přihlášení nebo zapnutý veřejný režim čtení."]);
      setMissionArenaStatus("disabled");
      setMissionArenaWarnings(["Pro načtení Mission Arena vrstvy je potřeba přihlášení nebo zapnutý veřejný režim čtení."]);
      setTakLayers([]);
      setTakSources([]);
      setTakStatus("disabled");
      setTakWarnings(["Partnerské vrstvy vyžadují přihlášení."]);
      return;
    }

    let cancelled = false;
    setSituationStatus("loading");
    setSafetyStatus("loading");
    setFlightStatus("loading");
    setCommunityStatus("loading");
    setMissionArenaStatus("loading");
    setTakStatus(authToken ? "loading" : "disabled");
    fetchMapCatalog(apiBase, authToken, { includePartner: Boolean(authToken) })
      .then((catalog) => {
        if (cancelled) {
          return;
        }
        setMapCatalog(catalog);
        const nextSituationLayers = mapCatalogToSituationLayers(catalog);
        const nextSafetyLayers = mapCatalogToSafetyLayers(catalog);
        const nextTakLayers = mapCatalogToTakLayers(catalog);
        setSituationLayers(nextSituationLayers);
        setSituationSources(mapCatalogToSituationSources(catalog));
        setSafetyLayers(nextSafetyLayers);
        setSafetySources(mapCatalogToSafetySources(catalog));
        setSafetyConfig(null);
        setTakLayers(nextTakLayers);
        setTakSources(mapCatalogToTakSources(catalog));
        setSituationWarnings(catalog.warnings);
        setSafetyWarnings(catalog.warnings);
        setFlightWarnings(catalog.warnings);
        setCommunityWarnings(catalog.warnings);
        setMissionArenaWarnings(catalog.warnings);
        setTakWarnings(authToken ? catalog.warnings : ["Partnerské vrstvy vyžadují přihlášení."]);
        setSituationStatus(providerStatusFromCatalog(catalog, "sim.situation-data"));
        setSafetyStatus(providerStatusFromCatalog(catalog, "sim.safety-data"));
        setFlightStatus(providerStatusFromCatalog(catalog, "sim.flight-data"));
        setCommunityStatus(providerStatusFromCatalog(catalog, "cop.community"));
        setMissionArenaStatus(providerStatusFromCatalog(catalog, "csm.mission-arena"));
        setTakStatus(authToken ? providerStatusFromCatalog(catalog, "sim.tak-gateway") : "disabled");
        setVisibleCatalogLayerIds((current) => {
          const availableLayerIds = new Set(selectableCatalogLayers(catalog).map((layer) => layer.layerId));
          if (catalogSelectionInitializedRef.current) {
            return current.filter((layerId) => availableLayerIds.has(layerId));
          }
          catalogSelectionInitializedRef.current = true;
          const fromLegacySelection = catalogLayerIdsFromLegacySelection(catalog, {
            safetyLayerIds: visibleSafetyLayerIds,
            situationLayerIds: visibleSituationLayerIds,
            situationSourceIds: visibleSituationSourceIds,
            takLayerIds: visibleTakLayerIds,
            trackLayerIds: visibleTrackLayerIds
          });
          const defaults = defaultVisibleCatalogLayerIds(catalog);
          const nextLayerIds = fromLegacySelection.length > 0 ? fromLegacySelection : defaults;
          return nextLayerIds.filter((layerId) => availableLayerIds.has(layerId));
        });
        if (initialPreferences.situationLayerIds === undefined) {
          const defaultLayers = nextSituationLayers
            .filter((layer) => layer.defaultVisible)
            .map((layer) => layer.layerId);
          if (defaultLayers.length > 0) {
            setVisibleSituationLayerIds(normalizeSituationLayerIds(defaultLayers));
          }
        }
        if (initialPreferences.safetyLayerIds === undefined) {
          const defaultLayers = nextSafetyLayers
            .filter((layer) => layer.defaultVisible)
            .map((layer) => layer.layerId);
          if (defaultLayers.length > 0) {
            setVisibleSafetyLayerIds(normalizeSafetyLayerIds(defaultLayers));
          }
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMapCatalog(null);
          setSituationLayers([]);
          setSituationSources([]);
          setSafetyLayers([]);
          setSafetySources([]);
          setSafetyConfig(null);
          setTakLayers([]);
          setTakSources([]);
          setSituationStatus("degraded");
          setSafetyStatus("degraded");
          setFlightStatus("degraded");
          setCommunityStatus("degraded");
          setMissionArenaStatus("degraded");
          setTakStatus("degraded");
          const message = error instanceof Error ? error.message : "Katalog mapových vrstev není dostupný.";
          setSituationWarnings([message]);
          setSafetyWarnings([message]);
          setFlightWarnings([message]);
          setCommunityWarnings([message]);
          setMissionArenaWarnings([message]);
          setTakWarnings([message]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiBase, authToken, dataAccessReady, initialPreferences.safetyLayerIds, initialPreferences.situationLayerIds]);

  const visibleCatalogLayerKey = visibleCatalogLayerIds.join(",");

  React.useEffect(() => {
    if (!mapCatalog) {
      return;
    }
    const legacySelection = legacySelectionFromCatalogLayerIds(mapCatalog, visibleCatalogLayerIds);
    setVisibleSituationLayerIds(legacySelection.situationLayerIds);
    setVisibleSituationSourceIds(legacySelection.situationSourceIds);
    setVisibleSafetyLayerIds(legacySelection.safetyLayerIds);
    setVisibleTakLayerIds(legacySelection.takLayerIds);
    setVisibleTrackLayerIds(legacySelection.trackLayerIds);
    setSelectedLayer(legacySelection.trackLayerIds[0] ?? "air-situation");
  }, [mapCatalog, visibleCatalogLayerKey]);

  React.useEffect(() => {
    if (!dataAccessReady) {
      return;
    }
    if (visibleSituationLayerIds.length === 0) {
      setSituationFeatures(null);
      setSituationStatus("disabled");
      setSituationWarnings([]);
      return;
    }
    if (!mapBounds) {
      return;
    }
    if (shouldSkipSituationFeatureLoad(mapBounds, mapView?.zoom)) {
      setSituationFeatures(null);
      setSituationStatus("zoom");
      setSituationWarnings(["Situační kontext se načítá až po přiblížení mapy na rozumný výřez."]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!mapCatalog) {
        return;
      }
      const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "sim.situation-data", visibleCatalogLayerIds);
      if (catalogLayerIds.length === 0) {
        setSituationFeatures(null);
        setSituationStatus("disabled");
        setSituationWarnings([]);
        return;
      }
      setSituationStatus((current) => current === "online" ? "online" : "loading");
      fetchMapFeatures(apiBase, authToken, {
        bbox: mapBounds,
        filters: buildCatalogFeatureFilters(catalogLayerIds, hasMobileCatalogSelection(catalogLayerIds) ? coverageTechnology : undefined),
        layerIds: catalogLayerIds,
        limit: 250,
      })
        .then((response) => {
          if (cancelled) {
            return;
          }
          const collection = response.situation ?? null;
          setSituationFeatures(collection);
          setSituationWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? []),
            ...(collection?.sourceHealth?.warnings ?? [])
          ]);
          setSituationStatus(collection ? situationStatusFromHealth(collection.sourceHealth?.health) : "online");
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSituationFeatures(null);
            setSituationStatus("degraded");
            setSituationWarnings([error instanceof Error ? error.message : "Situační kontext není dostupný."]);
          }
        });
    }, 2200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authToken, coverageTechnology, dataAccessReady, mapBounds, mapCatalog, mapView?.zoom, visibleCatalogLayerIds, visibleCatalogLayerKey]);

  React.useEffect(() => {
    if (!dataAccessReady) {
      return;
    }
    if (visibleSafetyLayerIds.length === 0) {
      setSafetyFeatures(null);
      setSafetyStatus("disabled");
      setSafetyWarnings([]);
      return;
    }
    if (!mapBounds) {
      return;
    }
    if (shouldSkipSituationFeatureLoad(mapBounds, mapView?.zoom)) {
      setSafetyFeatures(null);
      setSafetyStatus("zoom");
      setSafetyWarnings(["Bezpečnostní vrstvy se načítají až po přiblížení mapy na rozumný výřez."]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!mapCatalog) {
        return;
      }
      const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "sim.safety-data", visibleCatalogLayerIds);
      if (catalogLayerIds.length === 0) {
        setSafetyFeatures(null);
        setSafetyStatus("disabled");
        setSafetyWarnings([]);
        return;
      }
      setSafetyStatus((current) => current === "online" ? "online" : "loading");
      fetchMapFeatures(apiBase, authToken, {
        bbox: mapBounds,
        layerIds: catalogLayerIds,
        limit: 250
      })
        .then((response) => {
          if (cancelled) {
            return;
          }
          const collection = response.safety ?? null;
          setSafetyFeatures(collection);
          setSafetyWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? []),
            ...(collection?.sourceHealth?.warnings ?? [])
          ]);
          setSafetyStatus(collection ? situationStatusFromHealth(collection.sourceHealth?.health) : "online");
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSafetyFeatures(null);
            setSafetyStatus("degraded");
            setSafetyWarnings([error instanceof Error ? error.message : "Bezpečnostní vrstvy nejsou dostupné."]);
          }
        });
    }, 2200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authToken, dataAccessReady, mapBounds, mapCatalog, mapView?.zoom, visibleCatalogLayerIds, visibleCatalogLayerKey]);

  React.useEffect(() => {
    if (!dataAccessReady) {
      return;
    }
    if (!mapBounds) {
      return;
    }
    if (shouldSkipSituationFeatureLoad(mapBounds, mapView?.zoom)) {
      setFlightFeatures(null);
      setFlightStatus("zoom");
      setFlightWarnings(["Letecké reference se načítají až po přiblížení mapy na rozumný výřez."]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!mapCatalog) {
        return;
      }
      const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "sim.flight-data", visibleCatalogLayerIds);
      if (catalogLayerIds.length === 0) {
        setFlightFeatures(null);
        setFlightStatus("disabled");
        setFlightWarnings([]);
        return;
      }
      setFlightStatus((current) => current === "online" ? "online" : "loading");
      fetchMapFeatures(apiBase, authToken, {
        bbox: mapBounds,
        layerIds: catalogLayerIds,
        limit: 250
      })
        .then((response) => {
          if (cancelled) {
            return;
          }
          const collection = response.flight ?? null;
          setFlightFeatures(collection);
          setFlightWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? []),
            ...(collection?.sourceHealth?.warnings ?? [])
          ]);
          setFlightStatus(collection ? situationStatusFromHealth(collection.sourceHealth?.health) : "online");
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setFlightFeatures(null);
            setFlightStatus("degraded");
            setFlightWarnings([error instanceof Error ? error.message : "Letecké reference nejsou dostupné."]);
          }
        });
    }, 2200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBase, authToken, communityRefreshNonce, dataAccessReady, mapBounds, mapCatalog, mapView?.zoom, visibleCatalogLayerIds, visibleCatalogLayerKey]);

  React.useEffect(() => {
    if (!authToken) {
      setTakFeatures(null);
      return;
    }
    if (visibleTakLayerIds.length === 0) {
      setTakFeatures(null);
      setTakStatus("disabled");
      setTakWarnings([]);
      return;
    }
    if (!mapBounds) {
      return;
    }
    if (shouldSkipSituationFeatureLoad(mapBounds, mapView?.zoom)) {
      setTakFeatures(null);
      setTakStatus("zoom");
      setTakWarnings(["TAK Gateway se načítá až po přiblížení mapy na rozumný výřez."]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!mapCatalog) {
        return;
      }
      const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "sim.tak-gateway", visibleCatalogLayerIds);
      if (catalogLayerIds.length === 0) {
        setTakFeatures(null);
        setTakStatus("disabled");
        setTakWarnings([]);
        return;
      }
      setTakStatus((current) => current === "online" ? "online" : "loading");
      fetchMapFeatures(apiBase, authToken, {
        bbox: mapBounds,
        includePartner: true,
        layerIds: catalogLayerIds,
        limit: 250
      })
        .then((response) => {
          if (cancelled) {
            return;
          }
          const collection = response.tak ?? null;
          setTakFeatures(collection);
          setTakWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? []),
            ...(collection?.sourceHealth?.warnings ?? [])
          ]);
          setTakStatus(collection ? situationStatusFromHealth(collection.sourceHealth?.health) : "online");
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setTakFeatures(null);
            setTakStatus("degraded");
            setTakWarnings([error instanceof Error ? error.message : "TAK Gateway data nejsou dostupná."]);
          }
        });
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authToken, mapBounds, mapCatalog, mapView?.zoom, visibleCatalogLayerIds, visibleCatalogLayerKey]);

  React.useEffect(() => {
    if (!dataAccessReady) {
      return;
    }
    if (!mapBounds) {
      return;
    }
    if (shouldSkipSituationFeatureLoad(mapBounds, mapView?.zoom)) {
      setCommunityFeatures(null);
      setCommunityStatus("zoom");
      setCommunityWarnings(["Komunitní hlášení se načítají až po přiblížení mapy na rozumný výřez."]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!mapCatalog) {
        return;
      }
      const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "cop.community", visibleCatalogLayerIds);
      if (catalogLayerIds.length === 0) {
        setCommunityFeatures(null);
        setCommunityStatus("disabled");
        setCommunityWarnings([]);
        return;
      }
      setCommunityStatus((current) => current === "online" ? "online" : "loading");
      fetchMapFeatures(apiBase, authToken, {
        bbox: mapBounds,
        layerIds: catalogLayerIds,
        limit: 250
      })
        .then((response) => {
          if (cancelled) {
            return;
          }
          const collection = response.community ?? null;
          setCommunityFeatures(collection);
          setCommunityWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? [])
          ]);
          setCommunityStatus("online");
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setCommunityFeatures(null);
            setCommunityStatus("degraded");
            setCommunityWarnings([error instanceof Error ? error.message : "Komunitní hlášení nejsou dostupná."]);
          }
        });
    }, 1600);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBase, authToken, dataAccessReady, mapBounds, mapCatalog, mapView?.zoom, visibleCatalogLayerIds, visibleCatalogLayerKey]);

  React.useEffect(() => {
    if (!dataAccessReady) {
      return;
    }
    if (!mapBounds) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!mapCatalog) {
        return;
      }
      const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "csm.mission-arena", visibleCatalogLayerIds);
      if (catalogLayerIds.length === 0) {
        setMissionArenaFeatures(null);
        setMissionArenaStatus("disabled");
        setMissionArenaWarnings([]);
        return;
      }
      setMissionArenaStatus((current) => current === "online" ? "online" : "loading");
      fetchMapFeatures(apiBase, authToken, {
        bbox: mapBounds,
        layerIds: catalogLayerIds,
        limit: 50
      })
        .then((response) => {
          if (cancelled) {
            return;
          }
          const collection = response.missionArena ?? null;
          setMissionArenaFeatures(collection);
          setMissionArenaWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? []),
            ...(collection?.sourceHealth?.warnings ?? [])
          ]);
          setMissionArenaStatus(collection ? situationStatusFromHealth(collection.sourceHealth?.health) : "online");
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setMissionArenaFeatures(null);
            setMissionArenaStatus("degraded");
            setMissionArenaWarnings([error instanceof Error ? error.message : "Mission Arena vrstva není dostupná."]);
          }
        });
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBase, authToken, dataAccessReady, mapBounds, mapCatalog, visibleCatalogLayerIds, visibleCatalogLayerKey]);

  React.useEffect(() => {
    if (!dataAccessReady || !health || offlineSnapshotState.kind === "active" || streamStatus !== "live") {
      return;
    }
    const timer = window.setTimeout(() => {
      persistOfflineSnapshot({
        alerts: serverAlerts,
        health,
        objects,
        sourceHealth,
        sources,
        streamHealth: streamHealth ?? undefined,
        trackHistory
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    dataAccessReady,
    health,
    objects,
    offlineSnapshotState.kind,
    persistOfflineSnapshot,
    serverAlerts,
    sourceHealth,
    sources,
    streamHealth,
    streamStatus,
    trackHistory
  ]);

  React.useEffect(() => {
    setTrackHistory((current) => trimTrackHistory(current, trackHistoryLimit, trackHistoryWindowSeconds));
  }, [trackHistoryLimit, trackHistoryWindowSeconds]);

  React.useEffect(() => {
    if (!replayRunning) {
      return;
    }
    const timer = window.setInterval(() => {
      setReplayPosition((current) => Math.min(100, current + 2));
    }, 800);
    return () => window.clearInterval(timer);
  }, [replayRunning]);

  React.useEffect(() => {
    if (replayRunning && replayPosition >= 100) {
      setReplayRunning(false);
    }
  }, [replayPosition, replayRunning]);

  const replayWindow = React.useMemo(() => getReplayWindow(trackHistory), [trackHistory]);
  const replayTimestamp = React.useMemo(
    () => (showHistory ? getReplayTimestamp(trackHistory, replayPosition) : null),
    [replayPosition, showHistory, trackHistory]
  );
  const replayActive = Boolean(showHistory && replayTimestamp && replayPosition < 100);
  const replayTrackHistory = React.useMemo(
    () => (replayActive && replayTimestamp ? trimHistoryToTimestamp(trackHistory, replayTimestamp) : trackHistory),
    [replayActive, replayTimestamp, trackHistory]
  );
  const objectsForDisplay = React.useMemo(
    () => (replayActive && replayTimestamp ? selectReplayObjects(objects, trackHistory, replayTimestamp) : objects),
    [objects, replayActive, replayTimestamp, trackHistory]
  );

  const baseFilteredObjects = React.useMemo(
    () => filterVisibleObjects(objectsForDisplay, { includeSynthetic, minConfidence }),
    [includeSynthetic, minConfidence, objectsForDisplay]
  );
  const searchScopeObjects = React.useMemo(
    () => applyOperationalFilters(baseFilteredObjects, affiliationScope, domainScope, ""),
    [affiliationScope, baseFilteredObjects, domainScope]
  );
  const scopedObjects = React.useMemo(
    () => applyObjectSearch(searchScopeObjects, searchQuery),
    [searchScopeObjects, searchQuery]
  );
  const visibleObjectsSearchScope = React.useMemo(
    () => filterObjectsByLayers(searchScopeObjects, visibleTrackLayerIds),
    [searchScopeObjects, visibleTrackLayerIds]
  );
  const visibleObjects = React.useMemo(
    () => filterObjectsByLayers(scopedObjects, visibleTrackLayerIds),
    [scopedObjects, visibleTrackLayerIds]
  );
  const combinedSituationFeatures = React.useMemo(
    () => mergeSituationSafetyFlightCommunityMissionAndTakFeatures(situationFeatures, safetyFeatures, flightFeatures, communityFeatures, missionArenaFeatures, takFeatures),
    [communityFeatures, flightFeatures, missionArenaFeatures, safetyFeatures, situationFeatures, takFeatures]
  );
  const visibleFlightLayerCount = React.useMemo(() => countVisibleFlightReferenceLayers(mapCatalog, visibleCatalogLayerIds), [mapCatalog, visibleCatalogLayerIds]);
  const visibleCommunityLayerCount = React.useMemo(() => countVisibleCommunityLayers(mapCatalog, visibleCatalogLayerIds), [mapCatalog, visibleCatalogLayerIds]);
  const visibleMissionArenaLayerCount = React.useMemo(() => countVisibleMissionArenaLayers(mapCatalog, visibleCatalogLayerIds), [mapCatalog, visibleCatalogLayerIds]);
  const visibleSituationContextEnabled = visibleSituationLayerIds.length > 0 || visibleSafetyLayerIds.length > 0 || visibleTakLayerIds.length > 0 || visibleFlightLayerCount > 0 || visibleCommunityLayerCount > 0 || visibleMissionArenaLayerCount > 0;
  const mapLayerLabel = React.useMemo(
    () => buildMapLayerLabel(visibleTrackLayerIds, visibleSituationLayerIds, visibleSafetyLayerIds, visibleTakLayerIds, visibleFlightLayerCount, visibleCommunityLayerCount, visibleMissionArenaLayerCount),
    [visibleCommunityLayerCount, visibleFlightLayerCount, visibleMissionArenaLayerCount, visibleSafetyLayerIds, visibleSituationLayerIds, visibleTakLayerIds, visibleTrackLayerIds]
  );
  const mapEmptyMessage = React.useMemo(
    () =>
      buildMapEmptyMessage({
        contextLayersEnabled: visibleSituationContextEnabled,
        loadError,
        objects: objectsForDisplay,
        replayActive,
        scopedObjects,
        sources,
        visibleObjects
      }),
    [loadError, objectsForDisplay, replayActive, scopedObjects, sources, visibleObjects, visibleSituationContextEnabled]
  );
  const explicitlySelectedObject = selectedObjectId ? visibleObjects.find((object) => object.objectId === selectedObjectId) ?? null : null;
  const selectedObject = explicitlySelectedObject ?? visibleObjects[0] ?? null;
  const selectedSituationFeature = combinedSituationFeatures?.features.find((feature) => feature.properties.featureId === selectedSituationFeatureId) ?? null;
  const localMapSearchResults = React.useMemo(
    () => buildMapSearchResults(visibleObjectsSearchScope, combinedSituationFeatures?.features ?? [], mapSearchQuery),
    [combinedSituationFeatures, mapSearchQuery, visibleObjectsSearchScope]
  );
  const placeMapSearchResults = React.useMemo(
    () => buildPlaceSearchResults(placeSearchItems, mapSearchQuery, { limit: 5 }),
    [mapSearchQuery, placeSearchItems]
  );
  const mapSearchResults = React.useMemo(
    () => [...localMapSearchResults, ...placeMapSearchResults].slice(0, 12),
    [localMapSearchResults, placeMapSearchResults]
  );

  React.useEffect(() => {
    const query = mapSearchQuery.trim();
    if (!dataAccessReady || query.length < 3) {
      setPlaceSearchItems([]);
      setPlaceSearchError(null);
      setPlaceSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    setPlaceSearchLoading(true);
    setPlaceSearchError(null);
    const timer = window.setTimeout(() => {
      fetchPlaceGeocode(apiBase, authToken, query, { language: "cs,en", limit: 5 })
        .then((response) => {
          if (cancelled) {
            return;
          }
          setPlaceSearchItems(response.items);
          setPlaceSearchLoading(false);
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          setPlaceSearchItems([]);
          setPlaceSearchError(error instanceof Error ? error.message : "Vyhledávání míst není dostupné.");
          setPlaceSearchLoading(false);
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBase, authToken, dataAccessReady, mapSearchQuery]);

  const metrics = React.useMemo(() => buildMetrics(scopedObjects, sources), [scopedObjects, sources]);
  const eventStream = React.useMemo(() => buildEventStream(visibleObjects), [visibleObjects]);
  const historyPointCount = React.useMemo(
    () => countHistoryPoints(replayTrackHistory, visibleObjects),
    [replayTrackHistory, visibleObjects]
  );
  const proximityAlerts = React.useMemo(
    () =>
      proximityAlertEnabled && !replayActive
        ? buildProximityAlerts(baseFilteredObjects, userLocation, replayTrackHistory, alertRadiusKm, predictionMinutes, predictionMode)
        : [],
    [alertRadiusKm, baseFilteredObjects, predictionMinutes, predictionMode, proximityAlertEnabled, replayActive, replayTrackHistory, userLocation]
  );
  const alertSummary = React.useMemo(() => summarizeAlerts(serverAlerts, proximityAlerts), [proximityAlerts, serverAlerts]);
  const mapAlerts = React.useMemo(() => serverAlerts.filter((alert) => alert.status === "ACTIVE"), [serverAlerts]);
  const aoiRules = React.useMemo(() => alertPreferences.aoiRules ?? [], [alertPreferences.aoiRules]);
  const primaryAoiRule = aoiRules[0] ?? null;

  const applyPreferenceSettings = React.useCallback((settings: PreferenceSettings, options: { focusMap?: boolean } = {}) => {
    if (settings.activeWorkspace !== undefined) {
      setActiveWorkspace(normalizeWorkspaceModule(settings.activeWorkspace));
    }
    if (settings.selectedLayer !== undefined) {
      const nextLayer = readInitialLayer(settings.selectedLayer);
      setSelectedLayer(nextLayer);
      if (settings.trackLayerIds === undefined) {
        setVisibleTrackLayerIds([nextLayer]);
      }
    }
    if (settings.trackLayerIds !== undefined) {
      const fallbackLayer = settings.selectedLayer !== undefined ? readInitialLayer(settings.selectedLayer) : undefined;
      const nextTrackLayerIds = normalizeTrackLayerIds(settings.trackLayerIds, fallbackLayer);
      setVisibleTrackLayerIds(nextTrackLayerIds);
      setSelectedLayer(nextTrackLayerIds[0] ?? fallbackLayer ?? "air-situation");
    }
    if (settings.affiliationScope !== undefined) {
      setAffiliationScope(readInitialAffiliationScope(settings.affiliationScope));
    }
    if (settings.domainScope !== undefined) {
      setDomainScope(readInitialDomainScope(settings.domainScope));
    }
    if (settings.includeSynthetic !== undefined) {
      setIncludeSynthetic(settings.includeSynthetic);
    }
    if (settings.minConfidence !== undefined) {
      setMinConfidence(clamp(settings.minConfidence, 0, 1));
    }
    if (settings.autoRefresh !== undefined) {
      setAutoRefresh(settings.autoRefresh);
    }
    if (settings.refreshSeconds !== undefined) {
      setRefreshSeconds(normalizeRefreshSeconds(settings.refreshSeconds));
    }
    if (settings.showHistory !== undefined) {
      setShowHistory(settings.showHistory);
    }
    if (settings.trackHistoryDisplayMode !== undefined) {
      setTrackHistoryDisplayMode(normalizeTrackHistoryDisplayMode(settings.trackHistoryDisplayMode));
    }
    if (settings.publicFlightSymbolMode !== undefined) {
      setPublicFlightSymbolMode(normalizePublicFlightSymbolMode(settings.publicFlightSymbolMode));
    }
    if (settings.showPrediction !== undefined) {
      setShowPrediction(settings.showPrediction);
    }
    if (settings.mapClusterEnabled !== undefined) {
      setMapClusterEnabled(settings.mapClusterEnabled);
    }
    if (settings.mapBasemapMode !== undefined) {
      setMapBasemapMode(normalizeMapBasemapMode(settings.mapBasemapMode));
    }
    if (settings.catalogLayerIds !== undefined) {
      catalogSelectionInitializedRef.current = true;
      setVisibleCatalogLayerIds(normalizeCatalogLayerIds(settings.catalogLayerIds));
    }
    if (settings.showAlertAreas !== undefined) {
      setShowAlertAreas(settings.showAlertAreas);
    }
    if (settings.situationLayerIds !== undefined) {
      setVisibleSituationLayerIds(normalizeSituationLayerIds(settings.situationLayerIds));
    }
    if (settings.situationSourceIds !== undefined) {
      setVisibleSituationSourceIds(normalizeSourceIds(settings.situationSourceIds));
    }
    if (settings.situationCoverageTechnology !== undefined) {
      setCoverageTechnology(normalizeCoverageTechnology(settings.situationCoverageTechnology));
    }
    if (settings.safetyLayerIds !== undefined) {
      setVisibleSafetyLayerIds(normalizeSafetyLayerIds(settings.safetyLayerIds));
    }
    if (settings.takLayerIds !== undefined) {
      setVisibleTakLayerIds(normalizeTakLayerIds(settings.takLayerIds));
    }
    if (settings.predictionMinutes !== undefined) {
      setPredictionMinutes(clamp(settings.predictionMinutes, 2, 20));
    }
    if (settings.predictionMode !== undefined) {
      setPredictionMode(readInitialPredictionMode(settings.predictionMode));
    }
    if (settings.trackHistoryLimit !== undefined) {
      setTrackHistoryLimit(readInitialHistoryLimit(settings.trackHistoryLimit));
    }
    if (settings.trackHistoryWindowSeconds !== undefined) {
      setTrackHistoryWindowSeconds(normalizeHistoryWindowSeconds(settings.trackHistoryWindowSeconds));
    }
    if (settings.proximityAlertEnabled !== undefined) {
      setProximityAlertEnabled(settings.proximityAlertEnabled);
    }
    if (settings.alertRadiusKm !== undefined) {
      setAlertRadiusKm(clamp(settings.alertRadiusKm, 1, 50));
    }
    if (settings.autoFit !== undefined) {
      setAutoFit(settings.autoFit);
    }

    const normalizedMapView = normalizeMapView(settings.mapView);
    if (normalizedMapView) {
      setMapView(normalizedMapView);
      if (settings.autoFit === undefined) {
        setAutoFit(false);
      }
      if (options.focusMap) {
        setFocusViewRequest((current) => current + 1);
      }
    }
  }, []);

  const currentPreferences = React.useMemo<UserPreferences>(() => ({
    activeWorkspace,
    affiliationScope,
    alertRadiusKm,
    autoFit,
    autoRefresh,
    catalogLayerIds: visibleCatalogLayerIds,
    domainScope,
    includeSynthetic,
    mapClusterEnabled,
    mapBasemapMode,
    mapView,
    minConfidence,
    predictionMinutes,
    predictionMode,
    proximityAlertEnabled,
    publicFlightSymbolMode,
    refreshSeconds,
    safetyLayerIds: visibleSafetyLayerIds,
    selectedLayer,
    situationCoverageTechnology: coverageTechnology,
    showAlertAreas,
    showHistory,
    showPrediction,
    situationLayerIds: visibleSituationLayerIds,
    situationSourceIds: visibleSituationSourceIds,
    takLayerIds: visibleTakLayerIds,
    trackLayerIds: visibleTrackLayerIds,
    trackHistoryDisplayMode,
    trackHistoryLimit,
    trackHistoryWindowSeconds
  }), [
    activeWorkspace,
    affiliationScope,
    alertRadiusKm,
    autoFit,
    autoRefresh,
    domainScope,
    includeSynthetic,
    mapBasemapMode,
    mapClusterEnabled,
    mapView,
    minConfidence,
    predictionMinutes,
    predictionMode,
    proximityAlertEnabled,
    publicFlightSymbolMode,
    refreshSeconds,
    visibleSafetyLayerIds,
    visibleCatalogLayerIds,
    selectedLayer,
    coverageTechnology,
    showAlertAreas,
    showHistory,
    showPrediction,
    visibleSituationLayerIds,
    visibleSituationSourceIds,
    visibleTakLayerIds,
    visibleTrackLayerIds,
    trackHistoryDisplayMode,
    trackHistoryLimit,
    trackHistoryWindowSeconds
  ]);

  React.useEffect(() => {
    profileHydratedRef.current = false;
    profileLoadKeyRef.current = null;
    skipNextPreferenceWriteRef.current = true;
    const scopedPreferences = readUserPreferences(userStorageScope);
    catalogSelectionInitializedRef.current = scopedPreferences.catalogLayerIds !== undefined;
    setVisibleCatalogLayerIds(normalizeCatalogLayerIds(scopedPreferences.catalogLayerIds));
    applyPreferenceSettings(scopedPreferences, { focusMap: true });
    setViewProfiles(readViewProfiles(userStorageScope));
    setOfflineSnapshotState(initialOfflineSnapshotState(userStorageScope));
    setLastProfileName(null);
    setServerProfileUpdatedAt(null);
    setProfileSyncError(null);
    setProfileSyncStatus(profileAccessReady ? "loading" : "disabled");
  }, [applyPreferenceSettings, profileAccessReady, userStorageScope]);

  React.useEffect(() => {
    if (!profileAccessReady || !authToken) {
      profileHydratedRef.current = false;
      setProfileSyncStatus("disabled");
      return;
    }

    const loadKey = `${userStorageScope}:${authSession.profile?.subjectId ?? authSession.profile?.username ?? authSession.status}`;
    if (profileLoadKeyRef.current === loadKey) {
      return;
    }
    profileLoadKeyRef.current = loadKey;
    let cancelled = false;
    setProfileSyncStatus("loading");
    setProfileSyncError(null);

    fetchUserProfile(apiBase, authToken)
      .then(async (profile) => {
        if (cancelled) {
          return;
        }
        const serverPreferences = normalizeUserPreferences(profile.preferences);
        setAlertPreferences(profile.alertPreferences ?? {});
        setServerProfileUpdatedAt(profile.updatedAt);
        if (Object.keys(serverPreferences).length > 0) {
          writeUserPreferences(serverPreferences, userStorageScope);
          skipNextPreferenceWriteRef.current = true;
          applyPreferenceSettings(serverPreferences, { focusMap: true });
        } else {
          const localPreferences = readUserPreferences(userStorageScope);
          const seedPreferences = Object.keys(localPreferences).length > 0 ? localPreferences : currentPreferences;
          const savedProfile = await saveUserProfile(apiBase, authToken, {
            alertPreferences: profile.alertPreferences ?? {},
            preferences: seedPreferences
          });
          if (!cancelled) {
            setServerProfileUpdatedAt(savedProfile.updatedAt);
          }
        }
        if (!cancelled) {
          profileHydratedRef.current = true;
          setProfileSyncStatus("synced");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          profileHydratedRef.current = false;
          setProfileSyncStatus("error");
          setProfileSyncError(error instanceof Error ? error.message : "Synchronizace profilu selhala.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    applyPreferenceSettings,
    authSession.profile?.subjectId,
    authSession.profile?.username,
    authSession.status,
    authToken,
    currentPreferences,
    profileAccessReady,
    userStorageScope
  ]);

  React.useEffect(() => () => {
    if (profileSaveTimerRef.current !== undefined) {
      window.clearTimeout(profileSaveTimerRef.current);
    }
  }, []);

  React.useEffect(() => {
    if (skipNextPreferenceWriteRef.current) {
      skipNextPreferenceWriteRef.current = false;
      return;
    }
    writeUserPreferences(currentPreferences, userStorageScope);
    if (!profileAccessReady || !authToken || !profileHydratedRef.current) {
      return;
    }
    if (profileSaveTimerRef.current !== undefined) {
      window.clearTimeout(profileSaveTimerRef.current);
    }
    setProfileSyncStatus("saving");
    profileSaveTimerRef.current = window.setTimeout(() => {
      saveUserProfile(apiBase, authToken, {
        alertPreferences,
        preferences: currentPreferences
      })
        .then((profile) => {
          setServerProfileUpdatedAt(profile.updatedAt);
          setProfileSyncError(null);
          setProfileSyncStatus("synced");
        })
        .catch((error: unknown) => {
          setProfileSyncStatus("error");
          setProfileSyncError(error instanceof Error ? error.message : "Uložení profilu selhalo.");
        });
    }, 650);
  }, [
    alertPreferences,
    authToken,
    currentPreferences,
    profileAccessReady,
    userStorageScope
  ]);

  React.useEffect(() => {
    if (selectedObjectId && !visibleObjects.some((object) => object.objectId === selectedObjectId)) {
      setSelectedObjectId(null);
    }
  }, [selectedObjectId, visibleObjects]);

  React.useEffect(() => {
    if (selectedSituationFeatureId && !combinedSituationFeatures?.features.some((feature) => feature.properties.featureId === selectedSituationFeatureId)) {
      setSelectedSituationFeatureId(null);
    }
  }, [combinedSituationFeatures, selectedSituationFeatureId]);

  React.useEffect(() => {
    if (!proximityAlertEnabled || proximityAlerts.length === 0) {
      notifiedProximityAlertsRef.current.clear();
      return;
    }

    const activeKeys = new Set(proximityAlerts.map((alert) => `${alert.type}:${alert.object.objectId}`));
    notifiedProximityAlertsRef.current.forEach((key) => {
      if (!activeKeys.has(key)) {
        notifiedProximityAlertsRef.current.delete(key);
      }
    });

    const nextAlert = proximityAlerts.find((alert) => !notifiedProximityAlertsRef.current.has(`${alert.type}:${alert.object.objectId}`));
    if (!nextAlert) {
      return;
    }

    notifiedProximityAlertsRef.current.add(`${nextAlert.type}:${nextAlert.object.objectId}`);
    if (typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "granted") {
      new window.Notification("Výstraha v okolí", {
        body: formatProximityAlert(nextAlert)
      });
    }
  }, [proximityAlertEnabled, proximityAlerts]);

  async function askAi() {
    if (!authToken) {
      setAiResult("AI asistent je dostupný po přihlášení.");
      return;
    }
    const response = await fetch(`${apiBase}/api/v1/ai/cop-assistant/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        purpose: "DATA_QUALITY_CHECK",
        prompt: "Shrň kvalitu aktuálního situačního pohledu a odliš simulovaná data.",
        context: {
          objectIds: visibleObjects.map((object) => object.objectId)
        },
        providerPreference: "mock",
        outputFormat: "MARKDOWN",
        safetyScope: "COP_DATA_ASSISTANCE_ONLY"
      })
    });
    const payload = await response.json();
    setAiResult(payload.result?.summary ?? payload.policy?.reason ?? "AI odpověď není dostupná.");
  }

  async function handleProximityAlertToggle(checked: boolean) {
    setProximityAlertEnabled(checked);
    if (!checked) {
      return;
    }
    if (!userLocation) {
      locateUser();
    }
    if (typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "default") {
      await window.Notification.requestPermission();
    }
  }

  function updateAoiRule(ruleId: string, updater: (rule: AoiRule) => AoiRule) {
    setAlertPreferences((current) => {
      const currentRules = current.aoiRules ?? [];
      return {
        ...current,
        aoiRules: currentRules.map((rule) => (rule.id === ruleId ? normalizeClientAoiRule(updater(rule)) : rule))
      };
    });
  }

  function handleAoiRuleEnabledChange(ruleId: string, enabled: boolean) {
    updateAoiRule(ruleId, (rule) => ({ ...rule, affiliationScope: "all", enabled, severity: "warning" }));
  }

  function handleAoiRuleRadiusChange(ruleId: string, radiusKm: number) {
    updateAoiRule(ruleId, (rule) => ({ ...rule, affiliationScope: "all", radiusKm, severity: "warning" }));
  }

  function handleAoiRuleColorChange(ruleId: string, color: string) {
    updateAoiRule(ruleId, (rule) => ({ ...rule, color, fillOpacity: rule.fillOpacity ?? 0.12 }));
  }

  function handleAoiRuleDelete(ruleId: string) {
    setAlertPreferences((current) => ({
      ...current,
      aoiRules: (current.aoiRules ?? []).filter((rule) => rule.id !== ruleId)
    }));
  }

  function handleCreateAoiRuleFromMap() {
    const center: [number, number] = mapView?.center ?? [defaultAoiCenter.lon, defaultAoiCenter.lat];
    createAoiRule({ lat: center[1], lon: center[0] });
  }

  function handleCreateAoiRuleFromUserLocation() {
    if (!userLocation) {
      locateUser();
      return;
    }
    createAoiRule({ lat: userLocation.lat, lon: userLocation.lon });
  }

  function handleCreateAoiRuleFromPolygon(points: Array<{ lat: number; lon: number }>) {
    createAoiRuleFromPolygon(points);
    setZoneCreationMode(false);
  }

  function enableUserZoneLayer() {
    if (!visibleCatalogLayerIds.includes("user.zone.alerts")) {
      applyCatalogLayerSelection(toggleCatalogLayerId(visibleCatalogLayerIds, "user.zone.alerts", true));
    }
  }

  function createAoiRule(center: { lat: number; lon: number }) {
    enableUserZoneLayer();
    setAlertPreferences((current) => {
      const currentRules = current.aoiRules ?? [];
      const nextIndex = currentRules.length + 1;
      const color = zoneColorOptions[currentRules.length % zoneColorOptions.length];
      return {
        ...current,
        aoiRules: [
          ...currentRules,
          normalizeClientAoiRule({
            affiliationScope: "all",
            color,
            enabled: true,
            fillOpacity: 0.12,
            id: `user-zone-${Date.now()}`,
            lat: center.lat,
            lon: center.lon,
            name: `Zóna ${nextIndex}`,
            radiusKm: 10,
            severity: "warning"
          })
        ]
      };
    });
  }

  function createAoiRuleFromPolygon(points: Array<{ lat: number; lon: number }>) {
    const polygon = createAoiPolygonFromPoints(points);
    if (!polygon) {
      return;
    }
    const center = calculateAoiPolygonCenter(polygon);
    enableUserZoneLayer();
    setAlertPreferences((current) => {
      const currentRules = current.aoiRules ?? [];
      const nextIndex = currentRules.length + 1;
      const color = zoneColorOptions[currentRules.length % zoneColorOptions.length];
      return {
        ...current,
        aoiRules: [
          ...currentRules,
          normalizeClientAoiRule({
            affiliationScope: "all",
            color,
            enabled: true,
            fillOpacity: 0.14,
            id: `user-zone-${Date.now()}`,
            lat: center.lat,
            lon: center.lon,
            name: `Zóna ${nextIndex}`,
            polygon,
            radiusKm: calculateAoiPolygonRadiusKm(center, polygon),
            severity: "warning"
          })
        ]
      };
    });
  }

  function toggleSituationLayer(layerId: SituationLayerId) {
    setVisibleSituationLayerIds((current) => {
      if (current.includes(layerId)) {
        return current.filter((item) => item !== layerId);
      }
      return normalizeSituationLayerIds([...current, layerId]);
    });
  }

  function toggleSituationSource(sourceId: string) {
    setVisibleSituationSourceIds((current) => {
      const selectableSourceIds = filterCitizenSituationSources(
        situationSources.filter((source) => source.enabled !== false && !isSafetyOnlySituationSource(source))
      ).map((source) => source.sourceId);
      if (!selectableSourceIds.includes(sourceId)) {
        return sanitizeCitizenSituationSourceIds(current);
      }
      const sanitizedCurrent = sanitizeCitizenSituationSourceIds(current);
      const selected = new Set(sanitizedCurrent.length > 0 ? sanitizedCurrent : selectableSourceIds);
      if (selected.has(sourceId)) {
        if (selected.size <= 1) {
          return sanitizedCurrent;
        }
        selected.delete(sourceId);
      } else {
        selected.add(sourceId);
      }
      const next = selectableSourceIds.filter((item) => selected.has(item));
      return next.length === selectableSourceIds.length ? [] : next;
    });
  }

  function toggleSafetyLayer(layerId: SafetyLayerId) {
    setVisibleSafetyLayerIds((current) => {
      if (current.includes(layerId)) {
        return current.filter((item) => item !== layerId);
      }
      return normalizeSafetyLayerIds([...current, layerId]);
    });
  }

  function toggleTakLayer(layerId: TakLayerId) {
    setVisibleTakLayerIds((current) => {
      if (current.includes(layerId)) {
        return current.filter((item) => item !== layerId);
      }
      return normalizeTakLayerIds([...current, layerId]);
    });
  }

  function toggleTrackLayer(layerId: CopLayer) {
    setVisibleTrackLayerIds((current) => {
      if (layerId === "air-situation") {
        const next: CopLayer[] = current.includes("air-situation") ? [] : ["air-situation"];
        setSelectedLayer(next[0] ?? "air-situation");
        return next;
      }
      if (current.includes("air-situation")) {
        return current;
      }
      const next = current.includes(layerId)
        ? current.filter((item) => item !== layerId)
        : normalizeTrackLayerIds([...current, layerId], layerId);
      setSelectedLayer(next[0] ?? layerId);
      return next;
    });
  }

  function applyCatalogLayerSelection(nextLayerIds: string[]) {
    const normalizedLayerIds = normalizeCatalogLayerIds(nextLayerIds);
    catalogSelectionInitializedRef.current = true;
    setVisibleCatalogLayerIds(normalizedLayerIds);
  }

  function isCatalogLayerEnabled(layer: MapCatalogLayer): boolean {
    return visibleCatalogLayerIds.includes(layer.layerId);
  }

  function isCatalogLayerOperable(layer: MapCatalogLayer): boolean {
    return isImplementedCatalogLayer(layer);
  }

  function toggleCatalogLayer(layer: MapCatalogLayer) {
    if (!isCatalogLayerOperable(layer)) {
      return;
    }
    const enabled = isCatalogLayerEnabled(layer);
    if (layer.layerId === "user.zone.alerts") {
      if (aoiRules.length === 0 && !enabled) {
        setZoneCreationMode(true);
      }
      setAlertPreferences((current) => ({
        ...current,
        aoiRules: (current.aoiRules ?? []).map(normalizeClientAoiRule).map((zone) => ({ ...zone, enabled: !enabled }))
      }));
    }
    if (layer.layerId === "flight.sim.tracks" && !enabled) {
      setIncludeSynthetic(true);
    }
    applyCatalogLayerSelection(toggleCatalogLayerId(visibleCatalogLayerIds, layer.layerId, !enabled));
  }

  function catalogLayerFeatureCount(layer: MapCatalogLayer): number {
    const providerLayerIds = new Set(layer.query.providerLayerIds ?? []);
    const providerSourceIds = new Set(layer.query.providerSourceIds ?? []);
    const categoryIds = new Set(layer.query.categoryIds ?? []);
    if (layer.query.providerId === "sim.situation-data") {
      return (situationFeatures?.features ?? []).filter((feature) =>
        providerLayerIds.has(feature.properties.layer)
        && (providerSourceIds.size === 0 || providerSourceIds.has(feature.properties.sourceId))
        && (categoryIds.size === 0 || categoryIds.has(feature.properties.category))
      ).length;
    }
    if (layer.query.providerId === "sim.safety-data") {
      return (safetyFeatures?.features ?? []).filter((feature) => providerLayerIds.has(feature.properties.layer)).length;
    }
    if (layer.query.providerId === "sim.flight-data") {
      const streamLayer = flightReferenceLayerIdForStream(layer.query.streamId);
      return (flightFeatures?.features ?? []).filter((feature) =>
        (providerLayerIds.size > 0 && feature.properties.providerLayerId && providerLayerIds.has(feature.properties.providerLayerId))
        || (streamLayer !== undefined && flightReferenceQueryLayersToSituationLayers([streamLayer]).includes(feature.properties.layer))
      ).length;
    }
    if (layer.query.providerId === "cop.community") {
      return communityFeatures?.summary.featureCount ?? 0;
    }
    if (layer.query.providerId === "csm.mission-arena") {
      return missionArenaFeatures?.summary.featureCount ?? 0;
    }
    if (layer.query.providerId === "sim.tak-gateway") {
      return (takFeatures?.features ?? []).filter((feature) => providerLayerIds.has(feature.properties.layer)).length;
    }
    if (layer.layerId === "flight.public.tracks") {
      return visibleObjects.filter(isPublicFlightObject).length;
    }
    if (layer.layerId === "flight.sim.tracks") {
      return getSimulatedAirCount(visibleObjects);
    }
    if (layer.layerId === "user.zone.alerts") {
      return aoiRules.filter((zone) => zone.enabled).length;
    }
    return 0;
  }

  function catalogLayerStatus(layer: MapCatalogLayer): SituationLayerStatus {
    if (layer.query.providerId === "sim.situation-data") {
      return situationStatus;
    }
    if (layer.query.providerId === "sim.safety-data") {
      return safetyStatus;
    }
    if (layer.query.providerId === "sim.flight-data") {
      return flightStatus;
    }
    if (layer.query.providerId === "cop.community") {
      return communityStatus;
    }
    if (layer.query.providerId === "csm.mission-arena") {
      return missionArenaStatus;
    }
    if (layer.query.providerId === "sim.tak-gateway") {
      return takStatus;
    }
    if (layer.layerId === "flight.public.tracks") {
      return operatingMode === "OFFLINE" ? "degraded" : "online";
    }
    if (layer.layerId === "flight.sim.tracks") {
      return includeSynthetic ? (operatingMode === "OFFLINE" ? "degraded" : "online") : "disabled";
    }
    if (layer.layerId === "user.zone.alerts") {
      return aoiRules.some((zone) => zone.enabled) ? "online" : "disabled";
    }
    return "disabled";
  }

  async function acknowledgeServerAlert(alertId: string) {
    if (!authToken) {
      setLoadError("Potvrzení serverové výstrahy je dostupné po přihlášení.");
      return;
    }
    try {
      await acknowledgeCopAlert(apiBase, authToken, alertId);
      setServerAlerts((current) => current.filter((alert) => alert.alertId !== alertId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Potvrzení výstrahy se nepodařilo.");
    }
  }

  function locateUser() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("Prohlížeč neposkytuje geolokaci.");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location: UserLocation = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          updatedAt: new Date().toISOString()
        };
        setUserLocation(location);
        setLocationStatus(formatUserLocation(location));
        setFocusUserLocationRequest((current) => current + 1);
        setIsLocating(false);
      },
      (error) => {
        setLocationStatus(error.message || "Polohu se nepodařilo zaměřit.");
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 12_000
      }
    );
  }

  function selectMapSearchResult(result: MapSearchResult) {
    if (result.kind === "track" && result.objectId) {
      setSelectedObjectId(result.objectId);
      setSelectedSituationFeatureId(null);
    } else if (result.kind === "feature" && result.featureId) {
      setSelectedSituationFeatureId(result.featureId);
      setSelectedObjectId(null);
    } else if (result.kind === "place") {
      setSelectedObjectId(null);
      setSelectedSituationFeatureId(null);
    }
    setMapView({
      bearing: mapView?.bearing ?? 0,
      center: result.center,
      pitch: mapView?.pitch ?? 0,
      zoom: result.kind === "place" ? result.zoom ?? 10 : Math.max(mapView?.zoom ?? 10, result.kind === "track" ? 11 : 10)
    });
    setFocusViewRequest((current) => current + 1);
  }

  function openSettings(tab: SettingsTab) {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }

  function toggleReplayPlayback() {
    if (replayRunning) {
      setReplayRunning(false);
      return;
    }
    if (!replayWindow) {
      return;
    }
    setReplayPosition((current) => (current >= 100 ? 0 : current));
    setReplayRunning(true);
  }

  function jumpToLive() {
    setReplayRunning(false);
    setReplayPosition(100);
  }

  function loginOperator() {
    void beginLogin(authConfig);
  }

  function openLoginPrompt(reason: LoginPromptReason = "account") {
    if (!isOidcEnabled(authConfig)) {
      openSettings("account");
      return;
    }
    if (profileAccessReady) {
      openSettings("account");
      return;
    }
    setLoginPromptReason(reason);
  }

  function continueLoginFromPrompt() {
    setLoginPromptReason(null);
    loginOperator();
  }

  function startCommunityReportCapture() {
    locateUser();
    if (!profileAccessReady) {
      setProfileSyncError("Vlastní hlášení s polohou a přílohami je dostupné po přihlášení.");
      openLoginPrompt("report");
      return;
    }
    setCommunityReportDraft(createCommunityReportDraft(resolveCommunityReportLocation(userLocation, mapView)));
    setCommunityReportError(null);
    setCommunityReportSuccess(null);
    setCommunityReportLocationPickMode(false);
    setCommunityReportOpen(true);
    setLocationStatus("Sběr hlášení: doplňte popis, riziko, platnost a případné přílohy.");
  }

  function setCommunityReportLocationFromUser() {
    if (!userLocation) {
      locateUser();
      setCommunityReportError("Nejdřív zaměřuji vaši polohu. Po povolení polohy tlačítko použijte znovu.");
      return;
    }
    setCommunityReportDraft((current) => ({
      ...current,
      location: {
        ...(typeof userLocation.accuracyM === "number" ? { accuracyM: userLocation.accuracyM } : {}),
        lat: userLocation.lat,
        lon: userLocation.lon,
        source: "device"
      }
    }));
    setCommunityReportError(null);
  }

  function setCommunityReportLocationFromMapCenter() {
    setCommunityReportDraft((current) => ({
      ...current,
      location: resolveCommunityReportLocation(null, mapView)
    }));
    setCommunityReportError(null);
  }

  function startCommunityReportMapPick() {
    setCommunityReportLocationPickMode(true);
    setCommunityReportOpen(false);
    setCommunityReportError(null);
    setLocationStatus("Kliknutím do mapy určíte polohu nového hlášení.");
  }

  function handleCommunityReportLocationPicked(center: { lat: number; lon: number }) {
    setCommunityReportDraft((current) => ({
      ...current,
      location: {
        lat: center.lat,
        lon: center.lon,
        source: "manual"
      }
    }));
    setCommunityReportLocationPickMode(false);
    setCommunityReportOpen(true);
    setLocationStatus(`Poloha hlášení: ${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}`);
  }

  async function handleCommunityReportFilesSelected(files: File[]) {
    setCommunityReportDraft((current) => ({
      ...current,
      files,
      mediaLocationHint: ""
    }));
    if (files.length === 0) {
      return;
    }
    const located = await firstMediaLocation(files);
    if (!located) {
      setCommunityReportDraft((current) => ({
        ...current,
        mediaLocationHint: "V přiložených médiích jsem nenašel čitelnou polohu. Polohu nastavte z GPS nebo mapy."
      }));
      return;
    }
    setCommunityReportDraft((current) => ({
      ...current,
      location: located.location,
      mediaLocationHint: `Použita poloha ze souboru ${located.fileName}.`
    }));
    setLocationStatus(`Poloha hlášení převzata ze souboru ${located.fileName}.`);
  }

  async function handleCreateCommunityGroupFromReport() {
    if (!messagingAuthenticated || !authSession.accessToken) {
      openLoginPrompt("chat");
      return;
    }
    const name = communityReportDraft.newGroupName.trim();
    if (!name) {
      setCommunityReportError("Doplňte název skupiny.");
      return;
    }
    try {
      const group = await createCommunityGroupForUi(name, communityReportDraft.newGroupVisibility, {
        anchorLocation: communityReportDraft.location,
        metadata: {
          createdFrom: "report-dialog",
          initialCategory: communityReportDraft.category
        }
      });
      setCommunityReportDraft((current) => ({
        ...current,
        mediaAccessGroupId: group.groupId,
        mediaAccessMode: "groups",
        newGroupName: ""
      }));
      setCommunityReportError(null);
    } catch (error) {
      setCommunityReportError(error instanceof Error ? error.message : "Skupinu se nepodařilo vytvořit.");
    }
  }

  async function createCommunityGroupForUi(
    name: string,
    visibility: "private" | "public",
    options: { anchorLocation?: CommunityReportLocation; metadata?: Record<string, unknown> } = {}
  ): Promise<CommunityGroup> {
    return (await createCommunityGroupBundleForUi(name, visibility, options)).group;
  }

  async function createCommunityGroupBundleForUi(
    name: string,
    visibility: "private" | "public",
    options: { anchorLocation?: CommunityReportLocation; metadata?: Record<string, unknown> } = {}
  ): Promise<{ conversation?: MessagingConversationSummary; group: CommunityGroup }> {
    if (!messagingAuthenticated || !authSession.accessToken) {
      throw new Error("Pro správu skupin je potřeba přihlášení.");
    }
    const group = await createCommunityGroup(apiBase, authSession.accessToken, {
      anchorLocation: options.anchorLocation,
      metadata: options.metadata,
      name,
      visibility
    });
    setCommunityGroups((current) => [group, ...current.filter((item) => item.groupId !== group.groupId)]);
    let conversation: MessagingConversationSummary | undefined;
    try {
      const conversationResponse = await createMessagingConversation(apiBase, authSession.accessToken, {
        members: communityGroupMembersToMessagingMembers(group),
        metadata: {
          externalId: group.groupId,
          source: "cop.community"
        },
        title: group.name,
        type: "group"
      });
      if (conversationResponse.conversation) {
        conversation = {
          ...conversationResponse.conversation,
          metadata: {
            ...(conversationResponse.conversation.metadata ?? {}),
            externalId: group.groupId,
            source: "cop.community"
          }
        };
        setMessagingConversations((current) => [
          conversation as MessagingConversationSummary,
          ...current.filter((item) => item.conversationId !== conversation?.conversationId)
        ]);
        setMessagingConversationsError(conversationResponse.status === "online" ? null : conversationResponse.warnings[0] ?? "Konverzace byla založena s omezením.");
      } else {
        setMessagingConversationsError(conversationResponse.warnings[0] ?? "Konverzaci se nepodařilo založit.");
      }
    } catch (error) {
      setMessagingConversationsError(error instanceof Error ? error.message : "Konverzaci se nepodařilo založit.");
    }
    return {
      ...(conversation ? { conversation } : {}),
      group
    };
  }

  async function addCommunityGroupMemberForUi(groupId: string, subjectId: string, displayName?: string): Promise<CommunityGroup> {
    if (!messagingAuthenticated || !authSession.accessToken) {
      throw new Error("Pro správu skupin je potřeba přihlášení.");
    }
    const group = await upsertCommunityGroupMember(apiBase, authSession.accessToken, groupId, {
      displayName: displayName?.trim() || subjectId,
      role: "member",
      status: "active",
      subjectId,
      username: subjectId
    });
    setCommunityGroups((current) => current.map((item) => item.groupId === group.groupId ? group : item));
    await syncCommunityGroupMemberToConversation(group);
    return group;
  }

  async function syncCommunityGroupMemberToConversation(group: CommunityGroup): Promise<void> {
    if (!authSession.accessToken) {
      return;
    }
    const conversation = findMessagingConversationForCommunityGroup(group, messagingConversations);
    if (!conversation) {
      setMessagingConversationsError("Člen skupiny byl uložen, ale odpovídající konverzace pro synchronizaci nebyla nalezena.");
      return;
    }
    try {
      const result = await syncMessagingConversationMembers(
        apiBase,
        authSession.accessToken,
        conversation.conversationId,
        communityGroupMembersToMessagingMembers(group)
      );
      if (result.conversation) {
        const enrichedConversation = {
          ...result.conversation,
          metadata: {
            ...(result.conversation.metadata ?? conversation.metadata ?? {}),
            externalId: group.groupId,
            source: "cop.community"
          }
        };
        setMessagingConversations((current) => [
          enrichedConversation,
          ...current.filter((item) => item.conversationId !== enrichedConversation.conversationId)
        ]);
      }
      setMessagingConversationsError(result.status === "online" ? null : result.warnings[0] ?? "Člen skupiny byl uložen, synchronizace konverzace je omezená.");
    } catch (error) {
      setMessagingConversationsError(error instanceof Error ? error.message : "Člen skupiny byl uložen, ale synchronizace konverzace selhala.");
    }
  }

  async function submitCommunityReportDraft() {
    if (!authToken) {
      setCommunityReportError("Pro uložení hlášení je potřeba přihlášení.");
      openLoginPrompt("report");
      return;
    }
    const validationError = validateCommunityReportDraft(communityReportDraft);
    if (validationError) {
      setCommunityReportError(validationError);
      return;
    }
    setCommunityReportSubmitting(true);
    setCommunityReportError(null);
    setCommunityReportSuccess(null);
    setCommunityUploadProgress(null);
    const filesToUpload = communityReportDraft.files;
    try {
      if (filesToUpload.length > 0) {
        setCommunityUploadProgress({
          fileCount: filesToUpload.length,
          fileIndex: 1,
          fileName: filesToUpload[0]?.name || "Příloha",
          loadedBytes: 0,
          phase: "preparing",
          totalBytes: filesToUpload[0]?.size || 1
        });
      }
      let eventGroup = communityReportDraft.mediaAccessGroupId
        ? communityGroups.find((group) => group.groupId === communityReportDraft.mediaAccessGroupId) ?? null
        : null;
      if (!eventGroup) {
        const fallbackGroupName = communityReportDraft.newGroupName.trim()
          || communityReportDraft.title.trim()
          || communityReportCategoryLabelForValue(communityReportDraft.category);
        eventGroup = await createCommunityGroupForUi(fallbackGroupName, communityReportDraft.newGroupVisibility, {
          anchorLocation: communityReportDraft.location,
          metadata: {
            createdFrom: "community-report",
            initialCategory: communityReportDraft.category,
            initialSeverity: communityReportDraft.hazardSeverity
          }
        });
      }
      const reportPayload = {
        category: communityReportDraft.category,
        description: communityReportDraft.description.trim() || undefined,
        groupId: eventGroup.groupId,
        groupName: eventGroup.name,
        hazardSeverity: communityReportDraft.hazardSeverity,
        location: communityReportDraft.location,
        observedAt: new Date().toISOString(),
        title: communityReportDraft.title.trim(),
        validUntil: communityReportDraft.validUntil ? new Date(communityReportDraft.validUntil).toISOString() : undefined,
        visibility: "community"
      } as const;
      const report = communityReportDraft.reportId
        ? await updateCommunityReport(apiBase, authToken, communityReportDraft.reportId, reportPayload)
        : await createCommunityReport(apiBase, authToken, reportPayload);
      for (const [fileIndex, file] of filesToUpload.entries()) {
        const contentType = normalizeCommunityFileContentType(file);
        const kind = communityAttachmentKindFromContentType(contentType);
        if (!kind) {
          throw new Error(`Nepodporovaný typ souboru: ${file.name || contentType}`);
        }
        setCommunityUploadProgress({
          fileCount: filesToUpload.length,
          fileIndex: fileIndex + 1,
          fileName: file.name || "Příloha",
          loadedBytes: 0,
          phase: "creating",
          totalBytes: file.size || 1
        });
        const slot = await createCommunityAttachmentUpload(apiBase, authToken, report.reportId, {
          byteSize: file.size,
          captureLocation: communityReportDraft.location,
          contentType,
          fileName: file.name || undefined,
          kind,
          metadata: buildCommunityAttachmentMetadata(file, contentType, kind, communityReportDraft.videoSpatialMode, communityReportAccessPolicy({
            ...communityReportDraft,
            mediaAccessGroupId: eventGroup.groupId,
            mediaAccessMode: communityReportDraft.mediaAccessMode === "groups" ? "groups" : communityReportDraft.mediaAccessMode
          }))
        });
        await uploadCommunityAttachmentFile(apiBase, authToken, report.reportId, file, slot, (progress) => {
          setCommunityUploadProgress(uploadProgressFromAttachment(file, fileIndex, filesToUpload.length, progress));
        });
        setCommunityUploadProgress({
          fileCount: filesToUpload.length,
          fileIndex: fileIndex + 1,
          fileName: file.name || "Příloha",
          loadedBytes: file.size,
          phase: "finalizing",
          totalBytes: file.size || 1
        });
      }
      if (filesToUpload.length > 0) {
        const lastFile = filesToUpload[filesToUpload.length - 1];
        setCommunityUploadProgress({
          fileCount: filesToUpload.length,
          fileIndex: filesToUpload.length,
          fileName: lastFile?.name || "Přílohy",
          loadedBytes: lastFile?.size || 1,
          phase: "finalizing",
          totalBytes: lastFile?.size || 1
        });
      }
      const submitted = await submitCommunityReport(apiBase, authToken, report.reportId);
      setCommunityReportDraft(createCommunityReportDraft(resolveCommunityReportLocation(userLocation, mapView)));
      setCommunityReportSuccess(communityReportDraft.reportId ? "Hlášení bylo upraveno." : "Hlášení bylo uloženo a propojeno se skupinou.");
      setCommunityReportOpen(false);
      setCommunityReportLocationPickMode(false);
      setCommunityRefreshNonce((current) => current + 1);
      setSelectedSituationFeatureId(`community:${submitted.reportId}`);
      setSelectedObjectId(null);
      enableCommunityReportCatalogLayers();
      setLocationStatus("Hlášení bylo uloženo.");
    } catch (error) {
      setCommunityReportError(error instanceof Error ? error.message : "Hlášení se nepodařilo uložit.");
    } finally {
      setCommunityReportSubmitting(false);
      setCommunityUploadProgress(null);
    }
  }

  function editCommunityReportFeature(feature: SituationFeature) {
    const properties = feature.properties;
    if (properties.layer !== "community" || !properties.reportId) {
      return;
    }
    const coordinates = feature.geometry.type === "Point" ? feature.geometry.coordinates : null;
    const groupId = typeof properties.groupId === "string" ? properties.groupId : "";
    const severity = isCommunityHazardSeverityValue(properties.hazardSeverity)
      ? properties.hazardSeverity
      : isCommunityHazardSeverityValue(properties.severity)
        ? properties.severity
        : "warning";
    setCommunityReportDraft({
      ...createCommunityReportDraft({
        lat: coordinates ? coordinates[1] : defaultAoiCenter.lat,
        lon: coordinates ? coordinates[0] : defaultAoiCenter.lon,
        source: "manual"
      }),
      category: isCommunityReportCategoryValue(properties.category) ? properties.category : "hazard",
      description: properties.description ?? "",
      hazardSeverity: severity,
      mediaAccessGroupId: groupId,
      mediaAccessMode: groupId ? "groups" : "public",
      newGroupName: "",
      reportId: properties.reportId,
      title: properties.label ?? properties.headline ?? "",
      validUntil: properties.validUntil ? toDateTimeLocalValue(new Date(properties.validUntil)) : toDateTimeLocalValue(new Date(Date.now() + 2 * 60 * 60 * 1000))
    });
    setCommunityReportError(null);
    setCommunityReportSuccess(null);
    setCommunityReportOpen(true);
  }

  async function handleDeleteCommunityReport(reportId: string) {
    if (!authToken) {
      openLoginPrompt("report");
      return;
    }
    if (!window.confirm("Smazat toto hlášení včetně metadat příloh?")) {
      return;
    }
    try {
      await deleteCommunityReport(apiBase, authToken, reportId);
      setSelectedSituationFeatureId(null);
      setCommunityRefreshNonce((current) => current + 1);
      setLocationStatus("Hlášení bylo smazáno.");
    } catch (error) {
      setLocationStatus(error instanceof Error ? error.message : "Hlášení se nepodařilo smazat.");
    }
  }

  function enableCommunityReportCatalogLayers() {
    if (!mapCatalog) {
      return;
    }
    const reportLayerIds = mapCatalog.layers
      .filter((layer) => layer.query.providerId === "cop.community" && layer.selectable)
      .map((layer) => layer.layerId);
    if (reportLayerIds.length === 0) {
      return;
    }
    setVisibleCatalogLayerIds((current) => Array.from(new Set([...current, ...reportLayerIds])));
  }

  function logoutOperator() {
    endSession(authConfig, authSession);
    setAuthSession(createInitialAuthSession(authConfig));
  }

  function applyViewProfile(profile: ViewProfile) {
    applyPreferenceSettings(profile.settings, { focusMap: true });
    setLastProfileName(profile.name);
  }

  function saveCurrentViewProfile() {
    if (!profileAccessReady) {
      setProfileSyncError("Uložení profilu pohledu je dostupné po přihlášení.");
      openLoginPrompt("profile");
      return;
    }
    const now = new Date();
    const name = `Pohled ${workspaceLabel(activeWorkspace)} ${now.toLocaleTimeString("cs-CZ", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })}`;
    const profile: ViewProfile = {
      description: "Uložený lokální profil vrstev, filtrů, refresh režimu, replaye a aktuální mapy.",
      id: `custom-${now.getTime()}`,
      name,
      settings: {
        activeWorkspace,
        affiliationScope,
        alertRadiusKm,
        autoFit: false,
        autoRefresh,
        domainScope,
        includeSynthetic,
        mapBasemapMode,
        mapClusterEnabled,
        mapView,
        minConfidence,
        predictionMinutes,
        predictionMode,
        proximityAlertEnabled,
        publicFlightSymbolMode,
        refreshSeconds,
        safetyLayerIds: visibleSafetyLayerIds,
        selectedLayer,
        showAlertAreas,
        showHistory,
        showPrediction,
        situationLayerIds: visibleSituationLayerIds,
        situationSourceIds: visibleSituationSourceIds,
        takLayerIds: visibleTakLayerIds,
        trackLayerIds: visibleTrackLayerIds,
        trackHistoryDisplayMode,
        trackHistoryLimit,
        trackHistoryWindowSeconds
      }
    };
    const nextCustomProfiles = [...viewProfiles.filter((candidate) => !candidate.builtIn), profile].slice(-12);
    writeCustomViewProfiles(nextCustomProfiles, userStorageScope);
    setViewProfiles([...builtInViewProfiles, ...nextCustomProfiles]);
    setLastProfileName(profile.name);
  }

  const workspace = workspaceMetadata(activeWorkspace);
  const showMapLayerControls = activeWorkspace === "map";
  const showDataControls = activeWorkspace === "data";
  const showSourceControls = activeWorkspace === "sources";
  const showAlertControls = activeWorkspace === "alerts";
  const showReplayControls = activeWorkspace === "replay";
  const operatingMode = React.useMemo(
    () => resolveOperatingMode({ browserOnline, health, loadError, offlineSnapshotState, streamStatus }),
    [browserOnline, health, loadError, offlineSnapshotState, streamStatus]
  );
  const catalogGroupViews = React.useMemo(() => buildCatalogGroupViews(mapCatalog), [mapCatalog]);
  const activeCatalogGroup = catalogGroupViews.find((view) => view.group.groupId === activeCatalogGroupId) ?? null;

  React.useEffect(() => {
    if (activeCatalogGroupId && !catalogGroupViews.some((view) => view.group.groupId === activeCatalogGroupId)) {
      setActiveCatalogGroupId(null);
    }
  }, [activeCatalogGroupId, catalogGroupViews]);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <img src="/icons/cop-icon.svg" alt="" />
          </div>
          <div>
            <h1>
              <span className="brand-title-full">Civilní situační mapa</span>
              <span className="brand-title-compact">CSM</span>
            </h1>
            <p>Rizika v okolí, výstrahy a sdílené informace</p>
          </div>
        </div>
        <div className="mission-strip" aria-label="Civil situation map operating context">
          <span>LAB</span>
          <strong>{missionModeLabel(operatingMode, offlineSnapshotState)}</strong>
          <small>
            <span className="mission-detail-full">OpenStreetMap + situační vrstvy</span>
            <span className="mission-detail-compact">Zdroje {sources.length} · Obj. {visibleObjects.length}</span>
          </small>
        </div>
        <div className="status-strip">
          <StatusItem icon={<Wifi size={16} />} label="Mode" value={operatingMode} tone={operatingModeTone(operatingMode)} />
          <StatusItem icon={<Activity size={16} />} label="Stream" value={streamStatusLabel(streamStatus)} tone={streamStatusTone(streamStatus)} />
          <StatusItem icon={<RadioTower size={16} />} label="Sources" value={String(sources.length)} tone={metrics.activeSources > 0 ? "ok" : "warn"} />
          <StatusItem icon={<Database size={16} />} label="Objects" value={String(visibleObjects.length)} tone="neutral" />
        </div>
        <div className="topbar-actions">
          <a className="operator-button xr-entry-button" href="/xr" title="Otevřít prostorový XR režim">
            <Sparkles size={18} />
            <span>
              XR
              <strong>Quest</strong>
            </span>
          </a>
          <button
            aria-label={profileAccessReady ? "Účet - otevřít nastavení" : "Přihlásit"}
            className="operator-button"
            onClick={() => {
              if (profileAccessReady || !isOidcEnabled(authConfig)) {
                openSettings("account");
                return;
              }
              openLoginPrompt("account");
            }}
            title={profileAccessReady ? "Účet - otevřít nastavení" : "Přihlásit"}
            type="button"
          >
            <UserCircle size={19} />
            {!profileAccessReady && isOidcEnabled(authConfig) ? (
              <span>
                <strong>Přihlásit</strong>
              </span>
            ) : (
              <>
                <span>
                  Operátor
                  <strong>{operatorDisplayName(authSession, authConfig)}</strong>
                </span>
                <Settings size={16} />
              </>
            )}
          </button>
        </div>
      </header>

      <WorkspaceNavigator activeWorkspace={activeWorkspace} onChange={setActiveWorkspace} onOpenSettings={() => openSettings("map")} />

      <section className={`workspace workspace-${activeWorkspace}`}>
        <aside className={`panel left-panel ${showMapLayerControls ? "map-catalog-panel" : ""}`}>
          {!showMapLayerControls ? (
            <>
              <div className="refresh-row">
                <div>
                  <span>Poslední načtení</span>
                  <strong>{lastLoadedAt ?? "čekám na data"}</strong>
                </div>
                <button className="icon-button" onClick={() => void load()} disabled={isLoading} title="Obnovit situační data">
                  <RefreshCw size={16} className={isLoading ? "spin" : ""} />
                </button>
              </div>
              {loadError ? <div className="error-banner">API chyba: {loadError}. Poslední platná data zůstávají zobrazena.</div> : null}
              <OfflineSnapshotNotice state={offlineSnapshotState} mode={operatingMode} />
            </>
          ) : null}

          {showMapLayerControls ? (
            <CatalogLayerMenu
              activeGroup={activeCatalogGroup}
              groups={catalogGroupViews}
              loadError={loadError}
              statusLabel={missionModeLabel(operatingMode, offlineSnapshotState)}
              onCloseDrawer={() => setActiveCatalogGroupId(null)}
              onGroupSelect={(groupId) => setActiveCatalogGroupId((current) => current === groupId ? null : groupId)}
              getFeatureCount={catalogLayerFeatureCount}
              getLayerStatus={catalogLayerStatus}
              isLayerEnabled={isCatalogLayerEnabled}
              isLayerOperable={isCatalogLayerOperable}
              onToggleLayer={toggleCatalogLayer}
              coverageTechnology={coverageTechnology}
              onCoverageTechnologyChange={setCoverageTechnology}
              userZones={aoiRules}
              zoneCreationMode={zoneCreationMode}
              onUserZoneColorChange={handleAoiRuleColorChange}
              onUserZoneCreateFromMap={handleCreateAoiRuleFromMap}
              onUserZoneCreateFromUserLocation={handleCreateAoiRuleFromUserLocation}
              onUserZoneDelete={handleAoiRuleDelete}
              onUserZoneEnabledChange={handleAoiRuleEnabledChange}
              onUserZoneRadiusChange={handleAoiRuleRadiusChange}
              onUserZoneStartDrawing={() => setZoneCreationMode((current) => !current)}
            />
          ) : null}
          {showMapLayerControls ? <OfflineSnapshotNotice state={offlineSnapshotState} mode={operatingMode} /> : null}
          {showMapLayerControls && activeWorkspace === "map" && mapSearchDocked ? (
            <MapGlobalSearch
              docked
              isSearchingPlaces={placeSearchLoading}
              placeSearchError={placeSearchError}
              query={mapSearchQuery}
              results={mapSearchResults}
              onChange={setMapSearchQuery}
              onClear={() => setMapSearchQuery("")}
              onDockChange={(nextDocked) => {
                setMapSearchDocked(nextDocked);
                writeMapSearchDocked(nextDocked);
              }}
              onSelect={(result) => {
                selectMapSearchResult(result);
                setMapSearchQuery("");
              }}
            />
          ) : null}

          {showDataControls ? (
            <>
              <ViewProfilesPanel
                activeProfileName={lastProfileName}
                canSave={profileAccessReady}
                profiles={viewProfiles}
                userScope={userStorageScope}
                onApply={applyViewProfile}
                onLogin={() => openLoginPrompt("profile")}
                onSave={saveCurrentViewProfile}
              />

              <div className="mission-metrics">
                <MetricTile label="Vlastní" value={metrics.friendlyCount} tone="friend" />
                <MetricTile label="Rizikové" value={metrics.foreignCount} tone="hostile" />
                <MetricTile label="Confidence" value={`${metrics.avgConfidence}%`} tone={metrics.avgConfidence >= 75 ? "ok" : "warn"} />
                <MetricTile label="Alerts" value={alertSummary.total} tone={alertSummary.total > 0 ? "warn" : "ok"} />
              </div>

              <PanelTitle icon={<Layers size={17} />} title="Datové pohledy" />
              <LayerSourceTree
                metrics={metrics}
                scopedObjects={scopedObjects}
                selectedLayerIds={visibleTrackLayerIds}
                onToggleTrackLayer={toggleTrackLayer}
              />

              <div className="control-block">
                <PanelTitle icon={<SlidersHorizontal size={17} />} title="Filtry dat" />
                <ObjectSearchControl
                  resultCount={visibleObjects.length}
                  totalCount={visibleObjectsSearchScope.length}
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
                <label className="toggle-row">
                  <input type="checkbox" checked={includeSynthetic} onChange={(event) => setIncludeSynthetic(event.target.checked)} />
                  Zobrazit simulovaná data
                </label>
                <label className="range-label">
                  Minimum confidence
                  <input type="range" min="0" max="1" step="0.05" value={minConfidence} onChange={(event) => setMinConfidence(Number(event.target.value))} />
                  <span>{Math.round(minConfidence * 100)} %</span>
                </label>
                <SegmentedControl
                  label="Affiliation"
                  options={[
                    ["all", "Vše"],
                    ["friend", "Vlastní"],
                    ["hostile", "Rizikové"],
                    ["unknown", "Neznámé"]
                  ]}
                  value={affiliationScope}
                  onChange={(value) => setAffiliationScope(value as AffiliationScope)}
                />
                <SegmentedControl
                  label="Domain"
                  options={[
                    ["all", "All"],
                    ["AIR", "AIR"],
                    ["LAND", "LAND"],
                    ["RESCUE", "RESCUE"]
                  ]}
                  value={domainScope}
                  onChange={(value) => setDomainScope(value as DomainScope)}
                />
              </div>
            </>
          ) : null}

          {showAlertControls ? (
            <div className="workspace-module-card">
              <PanelTitle icon={<AlertTriangle size={17} />} title="Alert Center" />
              <ReadinessRow label="Serverové alerty" value={String(serverAlerts.length)} tone={serverAlerts.length > 0 ? "warn" : "ok"} />
              <ReadinessRow label="Critical" value={String(alertSummary.critical)} tone={alertSummary.critical > 0 ? "warn" : "ok"} />
              <ReadinessRow label="Vrstva na mapě" value={showAlertAreas || proximityAlertEnabled ? "aktivní" : "vypnuto"} tone={showAlertAreas || proximityAlertEnabled ? "ok" : "neutral"} />
              <ReadinessRow label="Uživatelské zóny" value={String(aoiRules.filter((rule) => rule.enabled).length)} tone={aoiRules.some((rule) => rule.enabled) ? "ok" : "neutral"} />
              <ReadinessRow label="Poloměr" value={`${alertRadiusKm} km`} tone="neutral" />
              <ReadinessRow label="Moje poloha" value={String(proximityAlerts.length)} tone={proximityAlerts.length > 0 ? "warn" : "ok"} />
              <button className="mini-button wide" onClick={() => void loadAlerts()} type="button">
                <RefreshCw size={14} />
                Obnovit alerty
              </button>
              <button className="mini-button wide" onClick={() => openSettings("awareness")} type="button">
                <Settings size={14} />
                Nastavení výstrah
              </button>
            </div>
          ) : null}

          {showReplayControls ? (
            <div className="workspace-module-card">
              <PanelTitle icon={<History size={17} />} title="Replay workspace" />
              <ReadinessRow label="Stav" value={formatReplayStatus(replayTimestamp, replayWindow, replayActive)} tone={replayActive ? "warn" : "neutral"} />
              <ReadinessRow label="Historie" value={`${trackHistoryWindowSeconds} s / ${historyPointCount} bodů`} tone={showHistory ? "ok" : "neutral"} />
              <ReadinessRow label="Predikce" value={showPrediction ? predictionModeLabel(predictionMode) : "vypnuto"} tone={showPrediction ? "ok" : "neutral"} />
              <div className="module-action-row">
                <button className="mini-button" disabled={!replayWindow} onClick={toggleReplayPlayback} type="button">
                  {replayRunning ? <Pause size={14} /> : <Play size={14} />}
                  {replayRunning ? "Pause" : "Play"}
                </button>
                <button className="mini-button" onClick={() => openSettings("map")} type="button">
                  <Settings size={14} />
                  Režim
                </button>
              </div>
            </div>
          ) : null}

          {showSourceControls ? (
            <>
              <div className="source-list">
                <PanelTitle icon={<ShieldCheck size={17} />} title="Source Registry" />
                {sources.map((source) => (
                  <div className="source-row" key={source.sourceSystemId}>
                    <span className={`dot ${source.status === "ACTIVE" ? "ok" : "warn"}`} />
                    <div>
                      <strong>{source.displayName}</strong>
                      <small>{source.sourceSystemId}</small>
                    </div>
                    <em>{source.status ?? "REGISTERED"}</em>
                  </div>
                ))}
                {sources.length === 0 ? <div className="empty-mini">Source Registry zatím nevrátil žádné zdroje.</div> : null}
              </div>

              <StreamHealthPanel health={streamHealth} telemetry={streamTelemetry} />
              <SourceHealthCenter items={sourceHealth} />
            </>
          ) : null}
        </aside>

        <section className={`center-column center-column-${activeWorkspace}`}>
          <section className="map-stage">
            {activeWorkspace === "map" && !mapSearchDocked ? (
              <MapGlobalSearch
                docked={false}
                isSearchingPlaces={placeSearchLoading}
                placeSearchError={placeSearchError}
                query={mapSearchQuery}
                results={mapSearchResults}
                onChange={setMapSearchQuery}
                onClear={() => setMapSearchQuery("")}
                onDockChange={(nextDocked) => {
                  setMapSearchDocked(nextDocked);
                  writeMapSearchDocked(nextDocked);
                }}
                onSelect={(result) => {
                  selectMapSearchResult(result);
                  setMapSearchQuery("");
                }}
              />
            ) : null}
            <CopMap
              alerts={mapAlerts}
              aoiRules={aoiRules}
              clusterTracks={mapClusterEnabled}
              objects={visibleObjects}
              emptyMessage={mapEmptyMessage}
              selectedSituationFeatureId={selectedSituationFeatureId ?? undefined}
              selectedObjectId={explicitlySelectedObject?.objectId}
              showHistory={showHistory}
              showPrediction={showPrediction}
              trackHistoryDisplayMode={trackHistoryDisplayMode}
              trackHistory={replayTrackHistory}
              publicFlightSymbolMode={publicFlightSymbolMode}
              mapBasemapMode={mapBasemapMode}
              predictionMinutes={predictionMinutes}
              predictionMode={predictionMode}
              autoFit={autoFit}
              alertRadiusKm={alertRadiusKm}
              focusView={mapView}
              focusViewRequest={focusViewRequest}
              focusUserLocationRequest={focusUserLocationRequest}
              hasProximityAlerts={proximityAlerts.length > 0}
              hasSituationContextEnabled={visibleSituationContextEnabled}
              initialView={mapView}
              mapLayerLabel={mapLayerLabel}
              situationFeatures={combinedSituationFeatures}
              onBoundsChange={setMapBounds}
              onSelectObject={(object) => {
                setSelectedObjectId((current) => current === object.objectId ? null : object.objectId);
                setSelectedSituationFeatureId(null);
              }}
              onSelectSituationFeature={(feature) => {
                setSelectedSituationFeatureId((current) => current === feature.properties.featureId ? null : feature.properties.featureId);
                setSelectedObjectId(null);
              }}
              onStartReport={startCommunityReportCapture}
              onAutoFitChange={setAutoFit}
              onClearSelection={() => {
                setSelectedObjectId(null);
                setSelectedSituationFeatureId(null);
              }}
              onCancelZoneCreation={() => setZoneCreationMode(false)}
              onCreateZonePolygon={handleCreateAoiRuleFromPolygon}
              onPickReportLocation={handleCommunityReportLocationPicked}
              onRequestUserLocation={locateUser}
              onViewChange={setMapView}
              reportLocationPickActive={communityReportLocationPickMode}
              showAlertAreas={showAlertAreas}
              showProximityAlertRadius={proximityAlertEnabled}
              userLocation={userLocation}
              zoneCreationActive={zoneCreationMode}
            />
          </section>

          {activeWorkspace === "map" ? null : activeWorkspace === "data" ? (
            <section className="operations-deck data-operations-deck">
              <div className="track-board data-track-board">
                <div className="deck-header">
                  <PanelTitle icon={<ListFilter size={17} />} title="Datové objekty" />
                  <span>{formatObjectSearchCount(visibleObjects.length, visibleObjectsSearchScope.length, searchQuery)}</span>
                </div>
                <ObjectSearchControl
                  compact
                  resultCount={visibleObjects.length}
                  totalCount={visibleObjectsSearchScope.length}
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
                <TrackTable
                  objects={visibleObjects}
                  selectedObjectId={explicitlySelectedObject?.objectId}
                  onSelect={(objectId) => {
                    setSelectedObjectId((current) => current === objectId ? null : objectId);
                    setSelectedSituationFeatureId(null);
                  }}
                />
              </div>
              <DataWorkspaceBoard
                metrics={metrics}
                objects={visibleObjects}
                selectedObject={selectedObject ?? null}
                selectedSituationFeature={selectedSituationFeature}
                situationFeatures={combinedSituationFeatures}
                onOpenSettings={() => openSettings("data")}
              />
            </section>
          ) : showSourceControls ? (
            <section className="operations-deck source-operations-deck">
              <div className="source-operations-board">
                <div className="deck-header">
                  <PanelTitle icon={<RadioTower size={17} />} title="Stav zdrojů" />
                  <span>{sourceHealth.length} zdrojů</span>
                </div>
                <ReadinessRow label="Flight data" value={sourceHealthSummary(sourceHealth, "flight")} tone={sourceHealthTone(sourceHealth, "flight")} />
                <ReadinessRow label="Situation data" value={formatSituationReadiness(situationStatus, situationFeatures)} tone={situationStatusTone(situationStatus)} />
                <ReadinessRow label="Safety data" value={formatSafetyReadiness(safetyStatus, safetyFeatures)} tone={situationStatusTone(safetyStatus)} />
                <ReadinessRow label="Source registry" value={`${sources.length} zdrojů`} tone={sources.length > 0 ? "ok" : "neutral"} />
              </div>
              <div className="source-operations-board">
                <div className="deck-header">
                  <PanelTitle icon={<Activity size={17} />} title="Stream" />
                  <span>{streamStatusLabel(streamStatus)}</span>
                </div>
                <ReadinessRow label="Mode" value={streamReadinessLabel(streamStatus, streamTelemetry)} tone={streamStatusTone(streamStatus)} />
                <ReadinessRow label="Latency" value={formatStreamLatency(streamTelemetry.latencyMs)} tone={streamLatencyTone(streamTelemetry)} />
                <ReadinessRow label="Last heartbeat" value={formatStreamObservation(streamTelemetry.lastHeartbeatAt)} tone={streamHeartbeatTone(streamTelemetry)} />
                <ReadinessRow label="Backpressure" value={formatBackpressureState(streamHealth, streamTelemetry)} tone={streamServerTone(streamHealth, streamTelemetry)} />
              </div>
            </section>
          ) : showAlertControls ? (
            <section className="operations-deck alert-operations-deck">
              <AlertCenterBoard
                alerts={serverAlerts}
                canAcknowledge={profileAccessReady}
                onAcknowledge={(alertId) => void acknowledgeServerAlert(alertId)}
                onLogin={() => openLoginPrompt("alert")}
                onSelectObject={(objectId) => {
                  setSelectedObjectId((current) => current === objectId ? null : objectId);
                  setSelectedSituationFeatureId(null);
                }}
              />
              <PersonalAlertBoard
                alerts={proximityAlerts}
                alertRadiusKm={alertRadiusKm}
                enabled={proximityAlertEnabled}
                onOpenSettings={() => openSettings("awareness")}
              />
            </section>
          ) : (
            <section className="operations-deck">
              <div className="track-board">
                <div className="deck-header">
                  <PanelTitle icon={<ListFilter size={17} />} title="Track list" />
                  <span>{formatObjectSearchCount(visibleObjects.length, visibleObjectsSearchScope.length, searchQuery)}</span>
                </div>
                <ObjectSearchControl
                  compact
                  resultCount={visibleObjects.length}
                  totalCount={visibleObjectsSearchScope.length}
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
                <TrackTable
                  objects={visibleObjects}
                  selectedObjectId={explicitlySelectedObject?.objectId}
                  onSelect={(objectId) => {
                    setSelectedObjectId((current) => current === objectId ? null : objectId);
                    setSelectedSituationFeatureId(null);
                  }}
                />
              </div>
              <div className="replay-board">
                <div className="deck-header">
                  <PanelTitle icon={<History size={17} />} title="Replay" />
                  <div className="deck-actions">
                    <button className="mini-button" disabled={!replayWindow} onClick={toggleReplayPlayback} type="button">
                      {replayRunning ? <Pause size={14} /> : <Play size={14} />}
                      {replayRunning ? "Pause" : "Play"}
                    </button>
                    <button className="mini-button" disabled={!replayWindow || replayPosition >= 100} onClick={jumpToLive} type="button">
                      Live
                    </button>
                  </div>
                </div>
                <div className={`timeline ${replayActive ? "replay-active" : ""}`}>
                  <Clock3 size={18} />
                  <div className="timeline-rail" aria-label="Replay position">
                    <span style={{ width: `${replayPosition}%` }} />
                    <input
                      aria-label="Pozice replaye"
                      disabled={!replayWindow}
                      max="100"
                      min="0"
                      onChange={(event) => {
                        setReplayRunning(false);
                        setReplayPosition(Number(event.target.value));
                      }}
                      step="1"
                      type="range"
                      value={replayPosition}
                    />
                  </div>
                  <strong>
                    {formatReplayStatus(replayTimestamp, replayWindow, replayActive)}
                  </strong>
                </div>
                <div className="timeline-meta">
                  <span>{visibleObjects.length} tracků</span>
                  <span>{historyPointCount} bodů historie</span>
                  <span>{replayWindow ? `${replayWindow.durationSeconds}s okno` : "bez historie"}</span>
                </div>
                <EventStream events={eventStream} />
              </div>
            </section>
          )}
        </section>

        <aside className="panel right-panel">
          {activeWorkspace !== "map" ? (
            <div className="workspace-context-card">
              <span>Workspace</span>
              <strong>{workspace.label}</strong>
              <p>{workspace.description}</p>
            </div>
          ) : null}

          <PanelTitle icon={<Database size={17} />} title={selectedSituationFeature ? "Situation detail" : "Object detail"} />
          {selectedSituationFeature ? (
            <SituationFeatureDetail
              feature={selectedSituationFeature}
              onDeleteReport={(reportId) => void handleDeleteCommunityReport(reportId)}
              onEditReport={(feature) => editCommunityReportFeature(feature)}
              onOpenGallery={(attachments, index, title, subtitle) => {
                const galleryAttachments = buildCommunityGalleryAttachments(communityFeatures, selectedSituationFeature, attachments);
                const selectedAttachmentId = attachments[index]?.attachmentId;
                const galleryIndex = Math.max(0, galleryAttachments.findIndex((attachment) => attachment.attachmentId === selectedAttachmentId));
                setCommunityGallery({
                  attachments: galleryAttachments,
                  index: galleryIndex,
                  subtitle,
                  title
                });
              }}
            />
          ) : selectedObject ? (
            <ObjectDetail
              historyPoints={replayTrackHistory[selectedObject.objectId] ?? []}
              object={selectedObject}
              replayActive={replayActive}
              sourceHealth={sourceHealth}
            />
          ) : (
            <div className="empty-state">Zatím nejsou přijata žádná situační data. Pošli validní ingest event ze SIM fixture.</div>
          )}

          {activeWorkspace === "data" || activeWorkspace === "sources" ? (
            <div className="readiness-box">
              <PanelTitle icon={<Gauge size={17} />} title="Data readiness" />
              <ReadinessRow label="Source coverage" value={metrics.activeSources > 0 ? "active" : "waiting"} tone={metrics.activeSources > 0 ? "ok" : "warn"} />
              <ReadinessRow label="Connectivity" value={operatingMode} tone={operatingModeTone(operatingMode)} />
              <ReadinessRow label="Offline snapshot" value={formatOfflineSnapshotState(offlineSnapshotState)} tone={offlineSnapshotTone(offlineSnapshotState)} />
              <ReadinessRow label="SIM data visible" value={includeSynthetic ? "enabled" : "hidden"} tone={includeSynthetic ? "ok" : "warn"} />
              <ReadinessRow label="SIM tracks" value={String(metrics.syntheticCount)} tone="neutral" />
              <ReadinessRow label="Public flights" value={String(metrics.publicFlightCount)} tone={metrics.publicFlightCount > 0 ? "ok" : "neutral"} />
              <ReadinessRow label="Situation context" value={formatSituationReadiness(situationStatus, situationFeatures)} tone={situationStatusTone(situationStatus)} />
              <ReadinessRow label="Safety data" value={formatSafetyReadiness(safetyStatus, safetyFeatures)} tone={situationStatusTone(safetyStatus)} />
              <ReadinessRow label="Stream mode" value={streamReadinessLabel(streamStatus, streamTelemetry)} tone={streamStatusTone(streamStatus)} />
              <ReadinessRow label="Stream latency" value={formatStreamLatency(streamTelemetry.latencyMs)} tone={streamLatencyTone(streamTelemetry)} />
              <ReadinessRow label="Last heartbeat" value={formatStreamObservation(streamTelemetry.lastHeartbeatAt)} tone={streamHeartbeatTone(streamTelemetry)} />
              <ReadinessRow label="Server clients" value={formatServerClientCount(streamHealth, streamTelemetry)} tone={streamServerTone(streamHealth, streamTelemetry)} />
              <ReadinessRow label="Backpressure" value={formatBackpressureState(streamHealth, streamTelemetry)} tone={streamServerTone(streamHealth, streamTelemetry)} />
              <ReadinessRow label="Reconnects" value={String(streamTelemetry.reconnectCount)} tone={streamTelemetry.reconnectCount > 0 ? "warn" : "ok"} />
              {streamTelemetry.lastError ? <ReadinessRow label="Stream error" value={streamTelemetry.lastError} tone="warn" /> : null}
              <ReadinessRow label="User profile" value={profileSyncLabel(profileSyncStatus)} tone={profileSyncTone(profileSyncStatus)} />
              <ReadinessRow label="Fallback sync" value={autoRefresh ? `${refreshSeconds} s` : "manual"} tone={autoRefresh ? "ok" : "neutral"} />
              <ReadinessRow label="Map clusters" value={mapClusterEnabled ? "enabled" : "off"} tone={mapClusterEnabled ? "ok" : "neutral"} />
              <ReadinessRow label="Alert map areas" value={showAlertAreas ? "enabled" : "off"} tone={showAlertAreas ? "warn" : "neutral"} />
              <ReadinessRow label="Track history" value={showHistory ? `${historyPointCount} pts` : "hidden"} tone={showHistory ? "ok" : "neutral"} />
              <ReadinessRow label="Replay" value={formatReplayStatus(replayTimestamp, replayWindow, replayActive)} tone={replayActive ? "warn" : "neutral"} />
              <ReadinessRow label="Alert Center" value={`${alertSummary.server} server · ${alertSummary.local} local`} tone={alertSummary.total > 0 ? "warn" : "ok"} />
              <ReadinessRow label="History window" value={`${trackHistoryWindowSeconds} s · max ${trackHistoryLimit} pts`} tone="neutral" />
              <ReadinessRow label="Prediction" value={showPrediction ? `${predictionModeLabel(predictionMode)} · ${predictionMinutes} min` : "hidden"} tone={showPrediction ? "ok" : "neutral"} />
              <ReadinessRow label="Policy scope" value="situační data" tone="neutral" />
            </div>
          ) : null}

          {activeWorkspace === "map" || activeWorkspace === "alerts" ? (
            <>
              <AccountAccessBox
                authenticated={profileAccessReady}
                profileSyncStatus={profileSyncStatus}
                publicReadEnabled={authConfig.publicReadEnabled}
                session={authSession}
                onLogin={() => openLoginPrompt("account")}
              />
              <div className="personal-awareness-box">
                <PanelTitle icon={<MapPin size={17} />} title="Moje poloha" />
                <button className="primary-button secondary" disabled={isLocating} onClick={locateUser} type="button">
                  <MapPin size={16} />
                  {isLocating ? "Zaměřuji polohu" : "Centrovat na mou polohu"}
                </button>
                <p>{locationStatus}</p>
                <ReadinessRow label="Výstraha" value={proximityAlertEnabled ? `${alertRadiusKm} km` : "vypnuto"} tone={proximityAlertEnabled ? "ok" : "neutral"} />
                <button className="mini-button wide" onClick={() => openSettings("awareness")} type="button">
                  <Settings size={14} />
                  Nastavení výstrah
                </button>
                <ProximityAlertList alerts={proximityAlerts} />
              </div>
            </>
          ) : null}

          {activeWorkspace === "data" ? (
          <div className="ai-box">
            <PanelTitle icon={<Bot size={17} />} title="AI assistant" />
            <p>{profileAccessReady ? aiResult : "AI asistent je přihlášená funkce. Veřejný režim zobrazuje data bez účtu, ale neposílá osobní ani provozní dotazy."}</p>
            {profileAccessReady ? (
              <button className="primary-button" onClick={askAi}>
                <Sparkles size={16} />
                Zkontrolovat kvalitu dat
              </button>
            ) : (
              <button className="primary-button secondary" onClick={() => openLoginPrompt("ai")} type="button">
                <LogIn size={16} />
                Přihlásit pro AI
              </button>
            )}
          </div>
          ) : null}
        </aside>
      </section>

      {settingsOpen ? (
        <SettingsDrawer
          activeTab={settingsTab}
          alertRadiusKm={alertRadiusKm}
          aoiRule={primaryAoiRule}
          authConfig={authConfig}
          authSession={authSession}
          autoRefresh={autoRefresh}
          includeSynthetic={includeSynthetic}
          mapBasemapMode={mapBasemapMode}
          minConfidence={minConfidence}
          predictionMinutes={predictionMinutes}
          predictionMode={predictionMode}
          publicFlightSymbolMode={publicFlightSymbolMode}
          profileSyncError={profileSyncError}
          profileSyncStatus={profileSyncStatus}
          proximityAlertEnabled={proximityAlertEnabled}
          refreshSeconds={refreshSeconds}
          serverProfileUpdatedAt={serverProfileUpdatedAt}
          mapClusterEnabled={mapClusterEnabled}
          showAlertAreas={showAlertAreas}
          showHistory={showHistory}
          showPrediction={showPrediction}
          trackHistoryDisplayMode={trackHistoryDisplayMode}
          trackHistoryLimit={trackHistoryLimit}
          trackHistoryWindowSeconds={trackHistoryWindowSeconds}
          onAlertRadiusKmChange={setAlertRadiusKm}
          onAoiRuleCenterFromMap={handleCreateAoiRuleFromMap}
          onAoiRuleCenterFromUserLocation={handleCreateAoiRuleFromUserLocation}
          onAoiRuleEnabledChange={(value) => {
            if (primaryAoiRule) {
              handleAoiRuleEnabledChange(primaryAoiRule.id, value);
            } else if (value) {
              handleCreateAoiRuleFromMap();
            }
          }}
          onAoiRuleRadiusKmChange={(value) => {
            if (primaryAoiRule) {
              handleAoiRuleRadiusChange(primaryAoiRule.id, value);
            }
          }}
          onAutoRefreshChange={setAutoRefresh}
          onClose={() => setSettingsOpen(false)}
          onIncludeSyntheticChange={setIncludeSynthetic}
          onMapBasemapModeChange={setMapBasemapMode}
          onMinConfidenceChange={setMinConfidence}
          onMapClusterEnabledChange={setMapClusterEnabled}
          onPredictionMinutesChange={setPredictionMinutes}
          onPredictionModeChange={setPredictionMode}
          onPublicFlightSymbolModeChange={setPublicFlightSymbolMode}
          onProximityAlertEnabledChange={(value) => void handleProximityAlertToggle(value)}
          onRefreshSecondsChange={setRefreshSeconds}
          onShowAlertAreasChange={setShowAlertAreas}
          onShowHistoryChange={setShowHistory}
          onShowPredictionChange={setShowPrediction}
          onTabChange={setSettingsTab}
          onTrackHistoryDisplayModeChange={setTrackHistoryDisplayMode}
          onTrackHistoryLimitChange={setTrackHistoryLimit}
          onTrackHistoryWindowSecondsChange={setTrackHistoryWindowSeconds}
          onLogin={loginOperator}
          onLogout={logoutOperator}
        />
      ) : null}

      {messagingLauncherEnabled ? (
        <button
          aria-label="Otevřít zprávy"
          className={`messaging-launcher ${messagingOpen ? "active" : ""}`}
          onClick={() => setMessagingOpen(true)}
          title="Otevřít komunikační okno"
          type="button"
        >
          <MessageCircle size={20} />
          <span>Chat</span>
        </button>
      ) : null}

      {messagingOpen ? (
        <MessagingPanel
          apiBase={apiBase}
          authenticated={messagingAuthenticated}
          authConfig={authConfig}
          authToken={messagingAuthenticated ? authSession.accessToken : undefined}
          conversations={messagingConversations}
          conversationsError={messagingConversationsError}
          communityGroups={communityGroups}
          communityGroupsError={communityGroupsError}
          error={messagingError}
          loading={messagingLoading}
          pinned={messagingPinned}
          session={authSession}
          status={messagingStatus}
          onAddGroupMember={(groupId, subjectId, displayName) => addCommunityGroupMemberForUi(groupId, subjectId, displayName)}
          onBindMatrixRoom={(conversationId, roomId, encrypted) =>
            bindMessagingConversationMatrixRoom(apiBase, authSession.accessToken ?? "", conversationId, { encrypted, roomId })
          }
          onClose={() => setMessagingOpen(false)}
          onCreateGroup={(name, visibility) => createCommunityGroupBundleForUi(name, visibility)}
          onLogin={() => openLoginPrompt("chat")}
          onPinnedChange={setMessagingPinned}
          onRefresh={() => void loadMessagingStatus()}
          onResolveMatrixIdentities={(userIds) =>
            resolveMessagingMatrixIdentities(apiBase, authSession.accessToken ?? "", userIds)
          }
        />
      ) : null}

      {loginPromptReason ? (
        <LoginRequiredDialog
          reason={loginPromptReason}
          onClose={() => setLoginPromptReason(null)}
          onContinue={continueLoginFromPrompt}
        />
      ) : null}

      {communityReportOpen ? (
        <CommunityReportDialog
          communityGroups={communityGroups}
          communityGroupsError={communityGroupsError}
          draft={communityReportDraft}
          error={communityReportError}
          isSubmitting={communityReportSubmitting}
          success={communityReportSuccess}
          uploadProgress={communityUploadProgress}
          onChange={setCommunityReportDraft}
          onClose={() => {
            setCommunityReportOpen(false);
            setCommunityReportError(null);
          }}
          onLocationFromMap={setCommunityReportLocationFromMapCenter}
          onLocationFromMapClick={startCommunityReportMapPick}
          onLocationFromUser={setCommunityReportLocationFromUser}
          onCreateGroup={() => void handleCreateCommunityGroupFromReport()}
          onFilesSelected={(files) => void handleCommunityReportFilesSelected(files)}
          onSubmit={() => void submitCommunityReportDraft()}
        />
      ) : null}
      {communityGallery ? (
        <CommunityMediaGallery
          gallery={communityGallery}
          onClose={() => setCommunityGallery(null)}
          onMove={(direction) => setCommunityGallery((current) => {
            if (!current) {
              return current;
            }
            return {
              ...current,
              index: (current.index + direction + current.attachments.length) % current.attachments.length
            };
          })}
        />
      ) : null}
    </main>
  );
}

interface CommunityReportDraft {
  category: CommunityReportCategory;
  description: string;
  files: File[];
  hazardSeverity: CommunityReportHazardSeverity;
  location: CommunityReportLocation;
  mediaLocationHint: string;
  mediaAccessGroupId: string;
  mediaAccessMode: CommunityMediaAccessMode;
  mediaAccessUserSubjectIds: string;
  newGroupName: string;
  newGroupVisibility: "private" | "public";
  reportId?: string;
  title: string;
  validUntil: string;
  videoSpatialMode: CommunityVideoSpatialMode;
}

interface CommunityGalleryState {
  attachments: NonNullable<SituationFeature["properties"]["attachments"]>;
  index: number;
  subtitle?: string;
  title: string;
}

interface CommunityUploadUiState {
  fileCount: number;
  fileIndex: number;
  fileName: string;
  loadedBytes: number;
  phase: "creating" | "direct" | "finalizing" | "preparing" | "proxy";
  totalBytes: number;
}

interface CommunityReportDialogProps {
  communityGroups: CommunityGroup[];
  communityGroupsError: string | null;
  draft: CommunityReportDraft;
  error: string | null;
  isSubmitting: boolean;
  success: string | null;
  uploadProgress: CommunityUploadUiState | null;
  onChange: React.Dispatch<React.SetStateAction<CommunityReportDraft>>;
  onClose: () => void;
  onCreateGroup: () => void;
  onFilesSelected: (files: File[]) => void;
  onLocationFromMap: () => void;
  onLocationFromMapClick: () => void;
  onLocationFromUser: () => void;
  onSubmit: () => void;
}

function CommunityReportDialog({
  communityGroups,
  communityGroupsError,
  draft,
  error,
  isSubmitting,
  success,
  uploadProgress,
  onChange,
  onClose,
  onCreateGroup,
  onFilesSelected,
  onLocationFromMap,
  onLocationFromMapClick,
  onLocationFromUser,
  onSubmit
}: CommunityReportDialogProps) {
  return (
    <ModalDialog
      actions={(
        <>
          <button className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">Zrušit</button>
          <button className="primary-button" disabled={isSubmitting} onClick={onSubmit} type="button">
            {isSubmitting ? "Ukládám..." : draft.reportId ? "Uložit změny" : "Uložit hlášení"}
          </button>
        </>
      )}
      className="report-dialog"
      closeDisabled={isSubmitting}
      description={draft.reportId ? "Upravte text, polohu, platnost, přístup a přílohy uloženého hlášení." : "Vložte ověřené hlášení s polohou, platností rizika a volitelnými přílohami."}
      eyebrow="Komunitní hlášení"
      onClose={onClose}
      title={draft.reportId ? "Upravit hlášení" : "Nahlásit událost v okolí"}
    >

        <div className="report-form-grid">
          <label>
            Typ události
            <SelectField<CommunityReportCategory>
              ariaLabel="Typ události"
              options={communityReportCategoryOptions}
              value={draft.category}
              onValueChange={(category) => onChange((current) => ({ ...current, category }))}
            />
          </label>
          <label>
            Odhad rizika
            <SelectField<CommunityReportHazardSeverity>
              ariaLabel="Odhad rizika"
              options={communityHazardSeverityOptions}
              value={draft.hazardSeverity}
              onValueChange={(hazardSeverity) => onChange((current) => ({ ...current, hazardSeverity }))}
            />
          </label>
        </div>

        <label className="report-field">
          Název
          <input
            maxLength={120}
            placeholder="Např. Požár u lesa"
            value={draft.title}
            onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))}
          />
        </label>

        <label className="report-field">
          Popis
          <textarea
            maxLength={2000}
            placeholder="Stručně popište, co je vidět a proč je to důležité."
            value={draft.description}
            onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))}
          />
        </label>

        <div className="report-form-grid">
          <label>
            Platnost rizika
            <input
              type="datetime-local"
              value={draft.validUntil}
              onChange={(event) => onChange((current) => ({ ...current, validUntil: event.target.value }))}
            />
          </label>
          <div className="report-coordinate-box">
            <span>Poloha</span>
            <strong>{formatReportLocation(draft.location)}</strong>
          </div>
        </div>
        {draft.mediaLocationHint ? <div className="report-dialog-message success">{draft.mediaLocationHint}</div> : null}

        <div className="report-location-actions">
          <button className="mini-button" onClick={onLocationFromUser} type="button">Moje poloha</button>
          <button className="mini-button" onClick={onLocationFromMap} type="button">Střed mapy</button>
          <button className="mini-button" onClick={onLocationFromMapClick} type="button">Vybrat v mapě</button>
        </div>

        <section className="report-access-panel">
          <div className="report-access-header">
            <strong>Skupina a média</strong>
            <span>{communityMediaAccessLabel(draft.mediaAccessMode)}</span>
          </div>
          <span className="report-field-hint">
            Každé hlášení je součástí skupiny. Skupina propojí mapový bod, konverzaci a přiložená média.
          </span>
          <SelectField<CommunityMediaAccessMode>
            ariaLabel="Přístup k médiím"
            options={communityMediaAccessOptions}
            value={draft.mediaAccessMode}
            onValueChange={(mediaAccessMode) => onChange((current) => ({ ...current, mediaAccessMode }))}
          />
          {draft.mediaAccessMode === "users" ? (
            <label className="report-field">
              Uživatelé
              <textarea
                maxLength={1200}
                placeholder="Každý řádek jeden subjectId uživatele. Později zde bude adresář kontaktů."
                value={draft.mediaAccessUserSubjectIds}
                onChange={(event) => onChange((current) => ({ ...current, mediaAccessUserSubjectIds: event.target.value }))}
              />
            </label>
          ) : null}
          {draft.mediaAccessMode === "groups" ? (
            <div className="report-group-picker">
              <label className="report-field">
                Skupina
                <select
                  value={draft.mediaAccessGroupId}
                  onChange={(event) => onChange((current) => ({ ...current, mediaAccessGroupId: event.target.value }))}
                >
                  <option value="">Vyberte skupinu</option>
                  {communityGroups.map((group) => (
                    <option key={group.groupId} value={group.groupId}>
                      {group.name} ({group.visibility === "public" ? "veřejná" : "soukromá"})
                    </option>
                  ))}
                </select>
              </label>
              <div className="report-create-group">
                <input
                  maxLength={80}
                  placeholder="Nová skupina, např. Povodně Vrbno"
                  value={draft.newGroupName}
                  onChange={(event) => onChange((current) => ({ ...current, newGroupName: event.target.value }))}
                />
                <SelectField<"private" | "public">
                  ariaLabel="Viditelnost nové skupiny"
                  options={communityGroupVisibilityOptions}
                  value={draft.newGroupVisibility}
                  onValueChange={(newGroupVisibility) => onChange((current) => ({ ...current, newGroupVisibility }))}
                />
                <button className="mini-button" onClick={onCreateGroup} type="button">Vytvořit</button>
              </div>
              {communityGroupsError ? <span className="report-field-hint">{communityGroupsError}</span> : null}
            </div>
          ) : null}
          <span className="report-field-hint">
            Text hlášení a stupeň výstrahy zůstávají v mapě. Fotky, PDF a videa otevře jen oprávněný uživatel.
          </span>
        </section>

        <label className="report-field">
          Přílohy
          <input
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,video/mp4,video/quicktime"
            multiple
            type="file"
            onChange={(event) => onFilesSelected(Array.from(event.target.files ?? []))}
          />
        </label>
        {draft.files.some(isCommunityVideoFile) ? (
          <label className="report-field">
            Režim videa
            <SelectField<CommunityVideoSpatialMode>
              ariaLabel="Režim videa"
              options={communityVideoSpatialOptions}
              value={draft.videoSpatialMode}
              onValueChange={(videoSpatialMode) => onChange((current) => ({ ...current, videoSpatialMode }))}
            />
            <span className="report-field-hint">
              Side-by-side a over-under se přehrají v XR přímo. iPhone Spatial MOV se uloží jako originál a server připraví 3D XR kopii.
            </span>
          </label>
        ) : null}
        <div className="report-attachment-list">
          {draft.files.length === 0 ? (
            <span>Bez příloh. Lze vložit fotografii, PDF nebo video.</span>
          ) : draft.files.map((file) => (
            <div className="report-attachment-row" key={`${file.name}-${file.size}-${file.lastModified}`}>
              <span>{file.name || "Soubor"}</span>
              <strong>{communityAttachmentKindLabel(communityAttachmentKindFromContentType(normalizeCommunityFileContentType(file)))} · {formatFileSize(file.size)}</strong>
            </div>
          ))}
        </div>

        {uploadProgress ? <CommunityUploadProgressPanel progress={uploadProgress} /> : null}
        {error ? <div className="report-dialog-message error">{error}</div> : null}
        {success ? <div className="report-dialog-message success">{success}</div> : null}
    </ModalDialog>
  );
}

function CommunityUploadProgressPanel({ progress }: { progress: CommunityUploadUiState }) {
  const total = progress.totalBytes > 0 ? progress.totalBytes : 1;
  const percent = Math.max(0, Math.min(100, Math.round((progress.loadedBytes / total) * 100)));
  const phaseLabel: Record<CommunityUploadUiState["phase"], string> = {
    creating: "Připravuji záznam",
    direct: "Nahrávám do úložiště",
    finalizing: "Dokončuji hlášení",
    preparing: "Připravuji upload",
    proxy: "Nahrávám přes zabezpečené API"
  };
  return (
    <div className="community-upload-progress" role="status" aria-live="polite">
      <div className="community-upload-progress-header">
        <span>{phaseLabel[progress.phase]}</span>
        <strong>{percent}%</strong>
      </div>
      <div className="community-upload-progress-bar" aria-label={`Průběh uploadu ${percent}%`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="community-upload-progress-meta">
        <span>{progress.fileIndex} / {progress.fileCount} · {progress.fileName}</span>
        <span>{formatFileSize(progress.loadedBytes)} / {formatFileSize(progress.totalBytes)}</span>
      </div>
      <small>Nezavírejte stránku, dokud ukládání neskončí.</small>
    </div>
  );
}

function CommunityMediaGallery({
  gallery,
  onClose,
  onMove
}: {
  gallery: CommunityGalleryState;
  onClose: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const attachment = gallery.attachments[gallery.index];
  const spatialMode = attachment?.kind === "video" ? communityAttachmentSpatialMode(attachment) : "none";
  const xrVideoUrl = attachment ? buildXrVideoUrl(attachment) : null;
  const xrDerivativeStatus = attachment ? communityAttachmentXrDerivativeStatus(attachment) : null;
  if (!attachment) {
    return null;
  }
  return (
    <div className="community-gallery-backdrop" role="presentation">
      <section className="community-gallery" aria-modal="true" role="dialog" aria-label="Galerie médií">
        <header className="community-gallery-header">
          <div>
            <span>{gallery.subtitle ?? "Komunitní média"}</span>
            <strong>{gallery.title}</strong>
            <small>{gallery.index + 1} / {gallery.attachments.length} · {attachment.fileName ?? communityAttachmentKindLabel(attachment.kind)}</small>
          </div>
          <button aria-label="Zavřít galerii" className="icon-button" onClick={onClose} type="button">
            <X size={20} />
          </button>
        </header>
        <div className="community-gallery-stage">
          {gallery.attachments.length > 1 ? (
            <button aria-label="Předchozí médium" className="community-gallery-nav prev" onClick={() => onMove(-1)} type="button">‹</button>
          ) : null}
          {attachment.contentUrl && attachment.kind === "photo" ? (
            <img alt={attachment.fileName ?? "Fotografie hlášení"} src={attachment.contentUrl} />
          ) : null}
          {attachment.contentUrl && attachment.kind === "video" ? (
            <video controls playsInline preload="metadata" src={attachment.contentUrl} />
          ) : null}
          {attachment.contentUrl && attachment.kind === "document" ? (
            <iframe src={attachment.contentUrl} title={attachment.fileName ?? "PDF příloha"} />
          ) : null}
          {!attachment.contentUrl ? (
            <div className="community-gallery-denied">
              {attachment.accessDenied ? "K tomuto médiu nemáte oprávnění." : "Médium zatím není dostupné."}
            </div>
          ) : null}
          {gallery.attachments.length > 1 ? (
            <button aria-label="Další médium" className="community-gallery-nav next" onClick={() => onMove(1)} type="button">›</button>
          ) : null}
        </div>
        <footer className="community-gallery-footer">
          <span>{communityAttachmentKindLabel(attachment.kind)} · {formatFileSize(attachment.byteSize)}</span>
          {attachment.kind === "video" ? <span>{communityAttachmentSpatialLabel(spatialMode)}</span> : null}
          {xrDerivativeStatus ? <span>{xrDerivativeStatus}</span> : null}
          {xrVideoUrl ? <a className="mini-button" href={xrVideoUrl} rel="noreferrer" target="_blank">Otevřít 3D v XR</a> : null}
          {attachment.contentUrl ? <a className="mini-button" href={attachment.contentUrl} rel="noreferrer" target="_blank">Otevřít soubor</a> : null}
        </footer>
      </section>
    </div>
  );
}

function ProximityAlertList({ alerts }: { alerts: ProximityAlert[] }) {
  if (alerts.length === 0) {
    return <div className="empty-mini">Bez aktivních výstrah pro mou polohu.</div>;
  }

  return (
    <div className="proximity-alert-list">
      {alerts.slice(0, 4).map((alert) => (
        <div className={`proximity-alert ${alert.type === "inside-radius" ? "critical" : "warning"}`} key={`${alert.type}-${alert.object.objectId}`}>
          <AlertTriangle size={15} />
          <div>
            <strong>{alert.object.objectId}</strong>
            <span>{formatProximityAlert(alert)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function LoginRequiredDialog({
  reason,
  onClose,
  onContinue
}: {
  reason: LoginPromptReason;
  onClose: () => void;
  onContinue: () => void;
}) {
  const content = loginPromptContent(reason);
  return (
    <ModalDialog
      actions={
        <>
          <button className="ghost-button" onClick={onClose} type="button">
            Zůstat na mapě
          </button>
          <button className="primary-button" onClick={onContinue} type="button">
            <LogIn size={16} />
            Přihlásit
          </button>
        </>
      }
      className="login-required-dialog"
      description={content.description}
      eyebrow="Přihlášení"
      onClose={onClose}
      title={content.title}
    >
      <div className="login-required-body">
        <div className="login-benefit-list" aria-label="Co přihlášení odemkne">
          {content.benefits.map((benefit) => (
            <span key={benefit}>
              <ShieldCheck size={15} />
              {benefit}
            </span>
          ))}
        </div>
        <div className="login-required-note">
          <UserCircle size={17} />
          <span>Veřejná mapa a základní vrstvy zůstávají dostupné i bez účtu.</span>
        </div>
      </div>
    </ModalDialog>
  );
}

function loginPromptContent(reason: LoginPromptReason): { benefits: string[]; description: string; title: string } {
  switch (reason) {
    case "ai":
      return {
        benefits: ["AI dotazy budou svázané s ověřenou relací.", "Veřejná data zůstanou čitelná bez účtu."],
        description: "AI asistent pracuje s osobním kontextem a proto vyžaduje přihlášeného uživatele.",
        title: "Přihlaste se pro AI asistenta"
      };
    case "alert":
      return {
        benefits: ["Potvrzení výstrah bude auditovatelné.", "Nastavení výstrah se uloží k vašemu profilu."],
        description: "Potvrzení nebo správa výstrah mění uživatelský stav aplikace, proto vyžaduje účet.",
        title: "Přihlaste se pro správu výstrah"
      };
    case "chat":
      return {
        benefits: ["Konverzace bude navázaná na ověřenou identitu.", "Skupiny a média budou respektovat přístupová práva."],
        description: "Zprávy, skupiny a chráněná média jsou přístupné jen ověřeným uživatelům.",
        title: "Přihlaste se pro konverzace"
      };
    case "profile":
      return {
        benefits: ["Uložíte si vrstvy, zoom, zóny a rozvržení.", "Profil bude dostupný i na dalším zařízení."],
        description: "Vlastní profily pohledu se ukládají na server k vašemu účtu.",
        title: "Přihlaste se pro uložení profilu"
      };
    case "report":
      return {
        benefits: ["Hlášení bude obsahovat autora, polohu a platnost.", "Přílohy se uloží s řízeným přístupem ke skupině nebo veřejně."],
        description: "Vlastní hlášení může obsahovat fotky, video, PDF a citlivou polohu, proto je potřeba ověřený účet.",
        title: "Přihlaste se pro vložení hlášení"
      };
    case "account":
    default:
      return {
        benefits: ["Odemkne se ukládání profilu a osobních zón.", "Zpřístupní se konverzace, skupiny, hlášení a chráněná média."],
        description: "Přihlášení doplní veřejný režim o osobní a komunitní funkce.",
        title: "Přihlášení k aplikaci"
      };
  }
}

function AlertCenterBoard({
  alerts,
  canAcknowledge,
  onAcknowledge,
  onLogin,
  onSelectObject
}: {
  alerts: CopAlert[];
  canAcknowledge: boolean;
  onAcknowledge: (alertId: string) => void;
  onLogin: () => void;
  onSelectObject: (objectId: string) => void;
}) {
  const summary = summarizeAlerts(alerts, []);
  return (
    <div className="alert-center-board">
      <div className="deck-header">
        <PanelTitle icon={<AlertTriangle size={17} />} title="Server Alert Center" />
        <span>{alerts.length} active</span>
      </div>
      <div className="alert-summary-grid">
        <MetricTile label="Critical" value={summary.critical} tone={summary.critical > 0 ? "warn" : "ok"} />
        <MetricTile label="Warning" value={summary.warning} tone={summary.warning > 0 ? "warn" : "ok"} />
      </div>
      <div className="alert-list">
        {alerts.length === 0 ? <div className="empty-mini">Žádné aktivní serverové alerty.</div> : null}
        {alerts.map((alert) => (
          <article className={`alert-row ${alert.severity}`} key={alert.alertId}>
            <div className="alert-severity-mark" aria-hidden="true" />
            <div className="alert-row-body">
              <div className="alert-row-heading">
                <strong>{alert.title}</strong>
                <span>{alertSeverityLabel(alert.severity)}</span>
              </div>
              <p>{alert.detail}</p>
              <div className="alert-row-meta">
                {alert.objectId ? <button type="button" onClick={() => onSelectObject(alert.objectId!)}>{alert.objectId}</button> : null}
                {alert.sourceSystemId ? <span>{alert.sourceSystemId}</span> : null}
                <span>{formatShortDateTime(alert.observedAt)}</span>
                <span>{alertTypeLabel(alert.type)}</span>
              </div>
            </div>
            {canAcknowledge ? (
              <button className="mini-button" onClick={() => onAcknowledge(alert.alertId)} type="button">
                Potvrdit
              </button>
            ) : (
              <button className="mini-button" onClick={onLogin} type="button">
                Přihlásit
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function AccountAccessBox({
  authenticated,
  profileSyncStatus,
  publicReadEnabled,
  session,
  onLogin
}: {
  authenticated: boolean;
  profileSyncStatus: ProfileSyncStatus;
  publicReadEnabled: boolean;
  session: AuthSession;
  onLogin: () => void;
}) {
  return (
    <div className="account-access-box">
      <PanelTitle icon={<UserCircle size={17} />} title="Režim účtu" />
      <ReadinessRow label="Mapa a veřejná data" value={publicReadEnabled ? "dostupné bez účtu" : "vyžaduje účet"} tone={publicReadEnabled ? "ok" : "warn"} />
      <ReadinessRow label="Přihlášení" value={authenticated ? session.profile?.name ?? "aktivní" : "bez přihlášení"} tone={authenticated ? "ok" : "neutral"} />
      <ReadinessRow label="Serverový profil" value={authenticated ? profileSyncLabel(profileSyncStatus) : "zamčeno"} tone={authenticated ? profileSyncTone(profileSyncStatus) : "neutral"} />
      <ReadinessRow label="Přispívání" value={authenticated ? "účet připraven" : "vyžaduje účet"} tone={authenticated ? "ok" : "neutral"} />
      {!authenticated ? (
        <>
          <p>Bez přihlášení zůstává aplikace read-only. Přihlášení odemkne ukládání profilu, potvrzování výstrah a komunitní hlášení.</p>
          <button className="primary-button secondary" onClick={onLogin} type="button">
            <LogIn size={16} />
            Přihlásit
          </button>
        </>
      ) : null}
    </div>
  );
}

function PersonalAlertBoard({
  alerts,
  alertRadiusKm,
  enabled,
  onOpenSettings
}: {
  alerts: ProximityAlert[];
  alertRadiusKm: number;
  enabled: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <div className="personal-alert-board">
      <div className="deck-header">
        <PanelTitle icon={<MapPin size={17} />} title="Moje poloha" />
        <span>{enabled ? `${alertRadiusKm} km` : "off"}</span>
      </div>
      <div className="personal-alert-copy">
        <ReadinessRow label="Vrstva" value={enabled ? "zapnuto" : "vypnuto"} tone={enabled ? "ok" : "neutral"} />
        <ReadinessRow label="Lokální alerty" value={String(alerts.length)} tone={alerts.length > 0 ? "warn" : "ok"} />
      </div>
      <ProximityAlertList alerts={alerts} />
      <button className="mini-button wide" onClick={onOpenSettings} type="button">
        <Settings size={14} />
        Nastavení perimetru
      </button>
    </div>
  );
}

function DataWorkspaceBoard({
  metrics,
  objects,
  selectedObject,
  selectedSituationFeature,
  situationFeatures,
  onOpenSettings
}: {
  metrics: DashboardMetrics;
  objects: CopObject[];
  selectedObject: CopObject | null;
  selectedSituationFeature: SituationFeature | null;
  situationFeatures: SituationFeatureCollectionResponse | null;
  onOpenSettings: () => void;
}) {
  const staleOrLostCount = objects.filter((object) => object.status === "STALE" || object.status === "LOST").length;
  const contextCount = situationFeatures?.summary.featureCount ?? 0;
  return (
    <div className="data-workspace-board">
      <div className="deck-header">
        <PanelTitle icon={<Database size={17} />} title="Datový přehled" />
        <button className="mini-button" onClick={onOpenSettings} type="button">
          <Settings size={14} />
          Nastavení dat
        </button>
      </div>

      <div className="data-summary-grid">
        <DataMetric label="Objekty" value={String(objects.length)} tone="neutral" />
        <DataMetric label="Nízká confidence" value={String(metrics.lowConfidenceCount)} tone={metrics.lowConfidenceCount > 0 ? "warn" : "ok"} />
        <DataMetric label="Stale/lost" value={String(staleOrLostCount)} tone={staleOrLostCount > 0 ? "warn" : "ok"} />
        <DataMetric label="Kontext" value={String(contextCount)} tone={contextCount > 0 ? "ok" : "neutral"} />
      </div>

      {selectedSituationFeature ? (
        <SelectedSituationDataCard feature={selectedSituationFeature} />
      ) : selectedObject ? (
        <SelectedObjectDataCard object={selectedObject} />
      ) : (
        <div className="empty-mini">Vyber objekt nebo situační prvek v mapě/tabulce. Tady se zobrazí stav, kvalita a zdrojová data.</div>
      )}
    </div>
  );
}

function DataMetric({ label, value, tone }: { label: string; value: string; tone: "critical" | "neutral" | "ok" | "warn" }) {
  return (
    <div className={`data-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SelectedObjectDataCard({ object }: { object: CopObject }) {
  const provenance = object.attributes?.provenance;
  return (
    <ObjectDetailSection title="Vybraný objekt">
      <DetailGrid
        rows={[
          ["ID", object.objectId],
          ["Stav", <StatusBadge key="status" label={object.status} tone={objectStatusTone(object.status)} />],
          ["Typ", `${object.objectType} / ${object.domain}`],
          ["Confidence", formatOptionalPercent(object.confidence)],
          ["Zdroj", provenance?.sourceSystemId ?? "n/a"],
          ["Aktualizace", formatShortDateTime(object.lastUpdatedAt ?? provenance?.producerTimestamp)]
        ]}
      />
    </ObjectDetailSection>
  );
}

function SelectedSituationDataCard({ feature }: { feature: SituationFeature }) {
  const status = situationFeatureStatusModel(feature);
  const rows: Array<[string, React.ReactNode]> = [
    ["Název", feature.properties.headline ?? feature.properties.label],
    ["Vrstva", situationDisplayLayerLabel(feature)],
    ["Stav", <StatusBadge key="status" label={status.label} tone={status.tone} />],
    ["Kategorie", feature.properties.category],
    ["Zdroj", feature.properties.sourceId],
    ["Aktualizace", formatShortDateTime(feature.properties.observedAt)]
  ];
  if (isTakGatewayFeature(feature)) {
    rows.push(
      ["Affiliation", formatTakAffiliation(feature.properties.affiliation)],
      ["Přijato", formatShortDateTime(feature.properties.receivedAt)],
      ["Platné do", formatShortDateTime(feature.properties.validUntil)]
    );
  }
  return (
    <ObjectDetailSection title="Vybraný situační prvek">
      <DetailGrid rows={rows} />
      {feature.properties.layer === "mobile_coverage" || feature.properties.layer === "mobile_network" ? <MobileCoverageSummary feature={feature} /> : null}
      {isCommunicationTowerFeature(feature) ? <CommunicationTowerSummary feature={feature} /> : null}
      {feature.properties.layer === "mobile" && !isTakGatewayFeature(feature) && !isCommunicationTowerFeature(feature) ? <MobileNetworkStatusSummary feature={feature} /> : null}
      {feature.properties.layer === "traffic" ? <TrafficSummary feature={feature} /> : null}
      {isAviationWeatherFeature(feature) ? <AviationWeatherSummary feature={feature} /> : null}
    </ObjectDetailSection>
  );
}

function MobileCoverageSummary({ feature }: { feature: SituationFeature }) {
  const properties = feature.properties;
  const quality = mobileCoverageQualityModel(properties.quality);
  return (
    <div className="mobile-status-summary">
      <DataMetric label="Kvalita" value={quality.label} tone={quality.tone} />
      <DataMetric label="Stav" value={formatMobileNetworkStatus(properties.status)} tone="neutral" />
      <DataMetric label="Technologie" value={properties.technology ?? "n/a"} tone="neutral" />
      <DataMetric label="Signál" value={formatOptionalNumber(properties.estimatedSignalDbm, " dBm")} tone={mobileMetricTone(properties.estimatedSignalDbm, -95, -110, true)} />
      <DataMetric label="Model" value={properties.modelVersion ?? "n/a"} tone="neutral" />
    </div>
  );
}

function MobileNetworkStatusSummary({ feature }: { feature: SituationFeature }) {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  return (
    <div className="mobile-status-summary">
      <DataMetric label="Download" value={formatOptionalNumber(recordNumber(metrics, "downloadMbps"), " Mbps")} tone={mobileMetricTone(recordNumber(metrics, "downloadMbps"), 15, 5, true)} />
      <DataMetric label="Upload" value={formatOptionalNumber(recordNumber(metrics, "uploadMbps"), " Mbps")} tone={mobileMetricTone(recordNumber(metrics, "uploadMbps"), 5, 1.5, true)} />
      <DataMetric label="Latence" value={formatOptionalNumber(recordNumber(metrics, "latencyMs"), " ms")} tone={mobileMetricTone(recordNumber(metrics, "latencyMs"), 75, 150, false)} />
      <DataMetric label="Signál" value={formatOptionalNumber(recordNumber(metrics, "lteRsrpDbm") ?? recordNumber(metrics, "signalStrengthDbm"), " dBm")} tone={mobileMetricTone(recordNumber(metrics, "lteRsrpDbm") ?? recordNumber(metrics, "signalStrengthDbm"), -100, -110, true)} />
    </div>
  );
}

function TrafficSummary({ feature }: { feature: SituationFeature }) {
  const presentation = resolveTransportPresentation(feature);
  if (!presentation) {
    return null;
  }
  return (
    <div className="mobile-status-summary traffic-status-summary">
      <DataMetric label="Typ" value={presentation.label} tone="neutral" />
      <DataMetric label="Linka" value={presentation.routeShortName ?? "n/a"} tone="neutral" />
      <DataMetric label="Stav" value={formatTransportCurrentStatus(presentation.currentStatus)} tone="neutral" />
      <DataMetric label="Rychlost" value={formatTransportSpeed(presentation.speedMps)} tone="neutral" />
      <DataMetric label="Zpoždění" value={formatTransportDelay(presentation.delaySeconds)} tone={trafficDelayTone(presentation.delaySeconds)} />
    </div>
  );
}

function TrafficDetailSection({ feature }: { feature: SituationFeature }) {
  const presentation = resolveTransportPresentation(feature);
  if (!presentation) {
    return null;
  }
  return (
    <ObjectDetailSection title={presentation.kind === "road_event" ? "Dopravní událost" : "Veřejná doprava"}>
      <DetailGrid
        rows={[
          ["Typ", presentation.label],
          ["Linka", presentation.routeShortName ?? "n/a"],
          ["Směr", presentation.destination ?? "n/a"],
          ["Stav", formatTransportCurrentStatus(presentation.currentStatus)],
          ["Zpoždění", formatTransportDelay(presentation.delaySeconds)],
          ["Rychlost", formatTransportSpeed(presentation.speedMps)],
          ["Směr pohybu", formatTransportHeading(presentation.headingDeg)],
          ["Obsazenost", formatTransportOccupancy(presentation.occupancyStatus, presentation.occupancyPercent)],
          ["Sekvence zastávky", formatOptionalInteger(presentation.stopSequence)],
          ["Vozidlo", presentation.vehicleId ?? "n/a"],
          ["Spoj", presentation.tripId ?? "n/a"],
          ["Dopravce", presentation.operator ?? "n/a"]
        ]}
      />
    </ObjectDetailSection>
  );
}

function CommunicationTowerSummary({ feature }: { feature: SituationFeature }) {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return (
    <div className="mobile-status-summary">
      <DataMetric label="Typ" value={stringProperty(tags.towerType) ?? "communication"} tone="neutral" />
      <DataMetric label="OSM" value={formatOsmReference(tags)} tone="neutral" />
      <DataMetric label="Status" value={formatCommunicationTowerStatus(feature.properties.status)} tone="neutral" />
      <DataMetric label="BTS" value={formatCommunicationTowerStatus(feature.properties.btsStatus)} tone="neutral" />
      <DataMetric label="Confidence" value={formatOptionalPercent(feature.properties.confidence)} tone="neutral" />
    </div>
  );
}

function AviationWeatherSummary({ feature }: { feature: SituationFeature }) {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return (
    <div className="mobile-status-summary">
      <DataMetric label="Kategorie" value={stringProperty(tags.flightCategory) ?? "n/a"} tone={aviationCategoryTone(stringProperty(tags.flightCategory))} />
      <DataMetric label="Vítr" value={formatWind(recordNumber(metrics, "windDirectionDeg"), recordNumber(metrics, "windSpeedMps"), recordNumber(metrics, "windSpeedKt"))} tone="neutral" />
      <DataMetric label="Teplota" value={formatOptionalNumber(recordNumber(metrics, "temperatureC"), " °C")} tone="neutral" />
      <DataMetric label="QNH" value={formatOptionalNumber(recordNumber(metrics, "altimeterHpa"), " hPa")} tone="neutral" />
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "neutral" | "ok" | "warn" | "critical" }) {
  return <span className={`status-badge ${tone}`}>{label}</span>;
}

function WorkspaceNavigator({
  activeWorkspace,
  onChange,
  onOpenSettings
}: {
  activeWorkspace: WorkspaceModule;
  onChange: (workspace: WorkspaceModule) => void;
  onOpenSettings: () => void;
}) {
  const modules: WorkspaceModule[] = ["map", "data", "sources", "alerts", "replay"];
  return (
    <nav className="workspace-nav" aria-label="Situační pracovní plocha">
      {modules.map((module) => {
        const metadata = workspaceMetadata(module);
        return (
          <button
            aria-pressed={activeWorkspace === module}
            className={`workspace-tab ${activeWorkspace === module ? "active" : ""}`}
            key={module}
            onClick={() => onChange(module)}
            title={metadata.description}
            type="button"
          >
            {workspaceIcon(module)}
            <span>{metadata.label}</span>
          </button>
        );
      })}
      <button className="workspace-settings-button" onClick={onOpenSettings} title="Nastavení operátora" type="button">
        <Settings size={16} />
        <span>Nastavení</span>
      </button>
    </nav>
  );
}

function ViewProfilesPanel({
  activeProfileName,
  canSave,
  profiles,
  userScope,
  onApply,
  onLogin,
  onSave
}: {
  activeProfileName: string | null;
  canSave: boolean;
  profiles: ViewProfile[];
  userScope: string;
  onApply: (profile: ViewProfile) => void;
  onLogin: () => void;
  onSave: () => void;
  }) {
  return (
    <div className="view-profile-box">
      <div className="view-profile-header">
        <PanelTitle icon={<UserCircle size={17} />} title="Profily pohledu" />
        <span>{userScope}</span>
      </div>
      <div className="view-profile-list">
        {profiles.map((profile) => (
          <button
            className={`view-profile-button ${activeProfileName === profile.name ? "active" : ""}`}
            key={profile.id}
            onClick={() => onApply(profile)}
            title={profile.description}
            type="button"
          >
            <span>{profile.name}</span>
            <small>{profile.builtIn ? "systémový profil" : "uložený profil"}</small>
          </button>
        ))}
      </div>
      {canSave ? (
        <button className="mini-button wide save-profile-button" onClick={onSave} type="button">
          <Settings size={14} />
          Uložit aktuální pohled
        </button>
      ) : (
        <div className="profile-login-gate">
          <span>Ukládání vlastních profilů je dostupné po přihlášení.</span>
          <button className="mini-button wide save-profile-button" onClick={onLogin} type="button">
            <LogIn size={14} />
            Přihlásit pro uložení
          </button>
        </div>
      )}
      {activeProfileName ? <div className="profile-applied-note">Aktivní: {activeProfileName}</div> : null}
    </div>
  );
}

function StatusItem({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "ok" | "warn" | "neutral" }) {
  return (
    <div className={`status-item ${tone}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OfflineSnapshotNotice({ mode, state }: { mode: OperatingMode; state: OfflineSnapshotState }) {
  if (state.kind !== "active") {
    return null;
  }

  return (
    <div className={`offline-snapshot-banner ${mode === "OFFLINE" ? "offline" : "degraded"}`}>
      <Wifi size={16} />
      <div>
        <strong>{mode === "OFFLINE" ? "Offline read-only režim" : "Degraded read-only fallback"}</strong>
        <span>
          Snapshot {formatSnapshotAge(state)} · {state.objectCount} objektů · {state.sourceCount} zdrojů
        </span>
      </div>
    </div>
  );
}

function applyCopStreamMessages(
  messages: CopStreamMessage[],
  context: {
    setLastLoadedAt: React.Dispatch<React.SetStateAction<string | null>>;
    setLastStreamAt: React.Dispatch<React.SetStateAction<string | null>>;
    setObjects: React.Dispatch<React.SetStateAction<CopObject[]>>;
    setStreamStatus: React.Dispatch<React.SetStateAction<CopStreamStatus>>;
    setTrackHistory: React.Dispatch<React.SetStateAction<TrackHistory>>;
    trackHistoryLimit: number;
    trackHistoryWindowSeconds: number;
  }
): void {
  const latestMessage = messages.at(-1);
  if (!latestMessage) {
    return;
  }

  const observedAt = latestMessage.serverTimestamp || new Date().toISOString();
  const observedAtLabel = formatStreamTime(observedAt);
  context.setLastStreamAt(observedAtLabel);
  context.setStreamStatus(latestMessage.type === "reconnect_required" ? "degraded" : "live");

  const dataMessages = messages.filter((message) => message.type === "snapshot" || message.type === "delta");
  if (dataMessages.length === 0) {
    return;
  }

  const latestDataMessage = dataMessages.at(-1);
  if (latestDataMessage) {
    context.setLastLoadedAt(formatStreamTime(latestDataMessage.serverTimestamp || observedAt));
  }

  let lastSnapshotIndex = -1;
  dataMessages.forEach((message, index) => {
    if (message.type === "snapshot") {
      lastSnapshotIndex = index;
    }
  });

  if (lastSnapshotIndex >= 0) {
    const snapshotObjects = dataMessages[lastSnapshotIndex]!.changes.map((change) => change.object);
    const deltaObjects = dataMessages
      .slice(lastSnapshotIndex + 1)
      .flatMap((message) => message.changes.map((change) => change.object));
    context.setObjects(upsertObjects(snapshotObjects, deltaObjects));
  } else {
    const deltaObjects = dataMessages.flatMap((message) => message.changes.map((change) => change.object));
    context.setObjects((current) => upsertObjects(current, deltaObjects));
  }

  context.setTrackHistory((current) =>
    dataMessages.reduce(
      (history, message) =>
        mergeTrackHistory(
          history,
          message.changes.map((change) => change.object),
          message.serverTimestamp || observedAt,
          context.trackHistoryLimit,
          context.trackHistoryWindowSeconds
        ),
      current
    )
  );
}

function upsertObjects(current: CopObject[], changedObjects: CopObject[]): CopObject[] {
  const next = new Map(current.map((object) => [object.objectId, object]));
  changedObjects.forEach((object) => next.set(object.objectId, object));
  return Array.from(next.values());
}

function streamStatusLabel(status: CopStreamStatus): string {
  if (status === "live") {
    return "LIVE";
  }
  if (status === "offline") {
    return "OFFLINE";
  }
  return "DEGRADED";
}

function resolveOperatingMode({
  browserOnline,
  health,
  loadError,
  offlineSnapshotState,
  streamStatus
}: {
  browserOnline: boolean;
  health: HealthStatus | null;
  loadError: string | null;
  offlineSnapshotState: OfflineSnapshotState;
  streamStatus: CopStreamStatus;
}): OperatingMode {
  if (!browserOnline || (offlineSnapshotState.kind === "active" && streamStatus === "offline")) {
    return "OFFLINE";
  }
  if (offlineSnapshotState.kind === "active" || loadError || health?.status !== "ok" || streamStatus !== "live") {
    return "DEGRADED";
  }
  return "ONLINE";
}

function operatingModeTone(mode: OperatingMode): "ok" | "warn" | "neutral" {
  return mode === "ONLINE" ? "ok" : "warn";
}

function missionModeLabel(mode: OperatingMode, snapshotState: OfflineSnapshotState): string {
  if (snapshotState.kind === "active") {
    return mode === "OFFLINE" ? "OFFLINE SNAPSHOT" : "DEGRADED SNAPSHOT";
  }
  if (mode === "ONLINE") {
    return "SIM LIVE";
  }
  return mode;
}

function streamStatusTone(status: CopStreamStatus): "ok" | "warn" | "neutral" {
  if (status === "live") {
    return "ok";
  }
  if (status === "connecting") {
    return "neutral";
  }
  return "warn";
}

function streamReadinessLabel(status: CopStreamStatus, telemetry: StreamTelemetry): string {
  if (status === "live") {
    return telemetry.lastMessageAt ? `live ${formatStreamObservation(telemetry.lastMessageAt)}` : "live";
  }
  if (status === "connecting") {
    return "connecting";
  }
  if (status === "offline") {
    return "offline";
  }
  return telemetry.lastError ? "fallback active" : "degraded";
}

function formatOfflineSnapshotState(state: OfflineSnapshotState): string {
  if (state.kind === "none") {
    return "není uložen";
  }
  const suffix = state.kind === "active" ? "aktivní" : "připraven";
  return `${suffix} · ${formatSnapshotAge(state)} · ${state.objectCount} obj.`;
}

function offlineSnapshotTone(state: OfflineSnapshotState): "ok" | "warn" | "neutral" {
  if (state.kind === "active") {
    return "warn";
  }
  return state.kind === "available" ? "ok" : "neutral";
}

function initialOfflineSnapshotState(scope: string): OfflineSnapshotState {
  const snapshot = readCopOfflineSnapshot(scope);
  if (!snapshot) {
    return { kind: "none" };
  }
  return {
    kind: "available",
    objectCount: snapshot.objectCount,
    savedAt: snapshot.savedAt,
    sourceCount: snapshot.sourceCount
  };
}

function formatSnapshotAge(snapshot: Pick<CopOfflineSnapshot, "savedAt">): string {
  const ageSeconds = snapshotAgeSeconds(snapshot);
  if (ageSeconds === null) {
    return "neznámé stáří";
  }
  if (ageSeconds < 60) {
    return `${ageSeconds} s starý`;
  }
  const ageMinutes = Math.round(ageSeconds / 60);
  if (ageMinutes < 60) {
    return `${ageMinutes} min starý`;
  }
  const ageHours = Math.round(ageMinutes / 60);
  return `${ageHours} h starý`;
}

function streamLatencyTone(telemetry: StreamTelemetry): "ok" | "warn" | "neutral" {
  if (telemetry.latencyMs === null) {
    return "neutral";
  }
  return telemetry.latencyMs > 5000 ? "warn" : "ok";
}

function streamHeartbeatTone(telemetry: StreamTelemetry): "ok" | "warn" | "neutral" {
  if (!telemetry.lastHeartbeatAt) {
    return "neutral";
  }
  const ageMs = Date.now() - Date.parse(telemetry.lastHeartbeatAt);
  if (!Number.isFinite(ageMs)) {
    return "neutral";
  }
  return ageMs > 45000 ? "warn" : "ok";
}

function streamServerTone(health: CopStreamHealth | null, telemetry: StreamTelemetry): "ok" | "warn" | "neutral" {
  if (health) {
    return health.status === "ok" && !health.metrics.backpressureActive ? "ok" : "warn";
  }
  return telemetry.lastBackpressureReason ? "warn" : "neutral";
}

function streamWriteErrorsTone(health: CopStreamHealth | null, telemetry: StreamTelemetry): "ok" | "warn" | "neutral" {
  const writeErrors = health?.metrics.writeErrorsTotal ?? telemetry.serverWriteErrorsTotal;
  if (writeErrors === null || writeErrors === undefined) {
    return "neutral";
  }
  return writeErrors > 0 ? "warn" : "ok";
}

function formatServerClientCount(health: CopStreamHealth | null, telemetry: StreamTelemetry): string {
  const clientCount = health?.metrics.clientCount ?? telemetry.serverClientCount;
  if (clientCount === null || clientCount === undefined) {
    return "n/a";
  }
  const threshold = health?.metrics.backpressureClientThreshold;
  return threshold ? `${clientCount}/${threshold}` : String(clientCount);
}

function formatBackpressureState(health: CopStreamHealth | null, telemetry: StreamTelemetry): string {
  if (health) {
    return health.metrics.backpressureActive ? `active · retry ${formatRetryMs(health.metrics.recommendedRetryMs)}` : "clear";
  }
  if (telemetry.lastBackpressureAt) {
    return `seen ${formatStreamObservation(telemetry.lastBackpressureAt)}`;
  }
  return "clear";
}

function formatStreamWriteErrors(health: CopStreamHealth | null, telemetry: StreamTelemetry): string {
  const writeErrors = health?.metrics.writeErrorsTotal ?? telemetry.serverWriteErrorsTotal;
  return writeErrors === null || writeErrors === undefined ? "n/a" : String(writeErrors);
}

function formatStreamMessageTotals(health: CopStreamHealth | null): string {
  const metrics = health?.metrics;
  if (!metrics) {
    return "n/a";
  }
  return `delta ${metrics.deltaMessagesTotal} · hb ${metrics.heartbeatMessagesTotal}`;
}

function formatRetryMs(value: number | null | undefined): string {
  if (!value) {
    return "n/a";
  }
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

function formatReplayStatus(timestamp: string | null, replayWindow: ReplayWindow | null, active: boolean): string {
  if (!replayWindow) {
    return "bez historie";
  }
  if (!active || !timestamp) {
    return "LIVE";
  }
  return `REPLAY ${formatShortDateTime(timestamp)}`;
}

function formatStreamTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return new Date().toLocaleTimeString("cs-CZ");
  }
  return timestamp.toLocaleTimeString("cs-CZ");
}

function MetricTile({ label, value, tone }: { label: string; value: string | number; tone: "friend" | "hostile" | "ok" | "warn" }) {
  return (
    <div className={`metric-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SourceHealthCenter({ items }: { items: SourceHealthItem[] }) {
  return (
    <div className="source-health-box">
      <PanelTitle icon={<Activity size={17} />} title="Source Health" />
      {items.length === 0 ? <div className="empty-mini">Health metriky zdrojů zatím nejsou dostupné.</div> : null}
      <div className="source-health-list">
        {items.map((item) => (
          <div className="source-health-row" key={item.sourceSystemId}>
            <div>
              <span className={`health-chip ${item.health.toLowerCase()}`}>{sourceHealthLabel(item.health)}</span>
              <strong>{item.displayName}</strong>
              <small>{item.sourceSystemId}</small>
            </div>
            <dl>
              <div>
                <dt>Tracks</dt>
                <dd>{item.currentTracks}/{item.totalTracks}</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>{item.acceptedEvents}</dd>
              </div>
              <div>
                <dt>Last</dt>
                <dd>{formatSourceAge(item.lastObservationAgeSeconds)}</dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd>{formatLatency(item.lastLatencyMs ?? item.avgLatencyMs)}</dd>
              </div>
            </dl>
            {item.staleTracks > 0 || item.expiredTracks > 0 || item.lowConfidenceTracks > 0 ? (
              <div className="source-health-warnings">
                {item.staleTracks > 0 ? <span>{item.staleTracks} stale</span> : null}
                {item.expiredTracks > 0 ? <span>{item.expiredTracks} expired</span> : null}
                {item.lowConfidenceTracks > 0 ? <span>{item.lowConfidenceTracks} low confidence</span> : null}
              </div>
            ) : null}
            {item.detail || item.lastError || item.warnings?.length ? (
              <div className="source-health-warnings">
                {item.detail ? <span>{item.detail}</span> : null}
                {item.lastError ? <span>{item.lastError}</span> : null}
                {item.warnings?.slice(0, 2).map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function StreamHealthPanel({ health, telemetry }: { health: CopStreamHealth | null; telemetry: StreamTelemetry }) {
  const metrics = health?.metrics;
  return (
    <div className="source-health-box stream-health-box">
      <PanelTitle icon={<Activity size={17} />} title="Stream Health" />
      <ReadinessRow label="Server status" value={health?.status ?? "waiting"} tone={streamServerTone(health, telemetry)} />
      <ReadinessRow label="Clients" value={formatServerClientCount(health, telemetry)} tone={streamServerTone(health, telemetry)} />
      <ReadinessRow label="Messages" value={formatStreamMessageTotals(health)} tone="neutral" />
      <ReadinessRow label="Last delta" value={formatStreamObservation(metrics?.lastDeltaAt ?? null)} tone={metrics?.lastDeltaAt ? "ok" : "neutral"} />
      <ReadinessRow label="Backpressure" value={formatBackpressureState(health, telemetry)} tone={streamServerTone(health, telemetry)} />
      <ReadinessRow label="Write errors" value={formatStreamWriteErrors(health, telemetry)} tone={streamWriteErrorsTone(health, telemetry)} />
    </div>
  );
}

function SettingsDrawer({
  activeTab,
  alertRadiusKm,
  aoiRule,
  authConfig,
  authSession,
  autoRefresh,
  includeSynthetic,
  mapBasemapMode,
  mapClusterEnabled,
  minConfidence,
  predictionMinutes,
  predictionMode,
  publicFlightSymbolMode,
  profileSyncError,
  profileSyncStatus,
  proximityAlertEnabled,
  refreshSeconds,
  serverProfileUpdatedAt,
  showAlertAreas,
  showHistory,
  showPrediction,
  trackHistoryDisplayMode,
  trackHistoryLimit,
  trackHistoryWindowSeconds,
  onAlertRadiusKmChange,
  onAoiRuleCenterFromMap,
  onAoiRuleCenterFromUserLocation,
  onAoiRuleEnabledChange,
  onAoiRuleRadiusKmChange,
  onAutoRefreshChange,
  onClose,
  onIncludeSyntheticChange,
  onMapBasemapModeChange,
  onMapClusterEnabledChange,
  onMinConfidenceChange,
  onPredictionMinutesChange,
  onPredictionModeChange,
  onPublicFlightSymbolModeChange,
  onProximityAlertEnabledChange,
  onRefreshSecondsChange,
  onShowAlertAreasChange,
  onShowHistoryChange,
  onShowPredictionChange,
  onTabChange,
  onTrackHistoryDisplayModeChange,
  onTrackHistoryLimitChange,
  onTrackHistoryWindowSecondsChange,
  onLogin,
  onLogout
}: {
  activeTab: SettingsTab;
  alertRadiusKm: number;
  aoiRule: AoiRule | null;
  authConfig: AuthConfig;
  authSession: AuthSession;
  autoRefresh: boolean;
  includeSynthetic: boolean;
  mapBasemapMode: MapBasemapMode;
  mapClusterEnabled: boolean;
  minConfidence: number;
  predictionMinutes: number;
  predictionMode: PredictionMode;
  publicFlightSymbolMode: PublicFlightSymbolMode;
  profileSyncError: string | null;
  profileSyncStatus: ProfileSyncStatus;
  proximityAlertEnabled: boolean;
  refreshSeconds: RefreshSeconds;
  serverProfileUpdatedAt: string | null;
  showAlertAreas: boolean;
  showHistory: boolean;
  showPrediction: boolean;
  trackHistoryDisplayMode: TrackHistoryDisplayMode;
  trackHistoryLimit: number;
  trackHistoryWindowSeconds: number;
  onAlertRadiusKmChange: (value: number) => void;
  onAoiRuleCenterFromMap: () => void;
  onAoiRuleCenterFromUserLocation: () => void;
  onAoiRuleEnabledChange: (value: boolean) => void;
  onAoiRuleRadiusKmChange: (value: number) => void;
  onAutoRefreshChange: (value: boolean) => void;
  onClose: () => void;
  onIncludeSyntheticChange: (value: boolean) => void;
  onMapBasemapModeChange: (value: MapBasemapMode) => void;
  onMapClusterEnabledChange: (value: boolean) => void;
  onMinConfidenceChange: (value: number) => void;
  onPredictionMinutesChange: (value: number) => void;
  onPredictionModeChange: (value: PredictionMode) => void;
  onPublicFlightSymbolModeChange: (value: PublicFlightSymbolMode) => void;
  onProximityAlertEnabledChange: (value: boolean) => void;
  onRefreshSecondsChange: (value: RefreshSeconds) => void;
  onShowAlertAreasChange: (value: boolean) => void;
  onShowHistoryChange: (value: boolean) => void;
  onShowPredictionChange: (value: boolean) => void;
  onTabChange: (value: SettingsTab) => void;
  onTrackHistoryDisplayModeChange: (value: TrackHistoryDisplayMode) => void;
  onTrackHistoryLimitChange: (value: number) => void;
  onTrackHistoryWindowSecondsChange: (value: number) => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="settings-backdrop" role="presentation">
      <aside className="settings-drawer" aria-label="Nastavení operátora">
        <div className="settings-header">
          <div>
            <span>Operátor</span>
            <strong>Nastavení</strong>
          </div>
          <button className="icon-button" onClick={onClose} title="Zavřít nastavení" type="button">
            <X size={16} />
          </button>
        </div>
        <div className="settings-tabs" role="tablist" aria-label="Sekce nastavení">
          {[
            ["map", "Mapa"],
            ["data", "Data"],
            ["awareness", "Výstrahy"],
            ["account", "Účet"]
          ].map(([tab, label]) => (
            <button
              aria-selected={activeTab === tab}
              className={activeTab === tab ? "active" : ""}
              key={tab}
              onClick={() => onTabChange(tab as SettingsTab)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="settings-content">
          {activeTab === "map" ? (
            <section className="settings-section">
              <PanelTitle icon={<Layers size={17} />} title="Zobrazení mapy" />
              <label className="toggle-row">
                <input type="checkbox" checked={mapClusterEnabled} onChange={(event) => onMapClusterEnabledChange(event.target.checked)} />
                Shlukovat objekty při oddálení
              </label>
              <p className="settings-help">Kliknutí na shluk mapu přiblíží a ukáže náhled objektů uvnitř. Po dalším přiblížení se shluky rozpadají do menších skupin a jednotlivých stop.</p>
              <SegmentedControl
                label="Mapový podklad"
                options={mapBasemapModeOptions}
                value={mapBasemapMode}
                onChange={(value) => onMapBasemapModeChange(value as MapBasemapMode)}
              />
              <p className="settings-help">Civilní a rizikový podklad tlumí detailní OSM mapu, aby výstrahy, povodně a komunitní hlášení byly čitelné jako hlavní vrstva.</p>
              <SegmentedControl
                label="Symbolika mapy"
                options={[
                  ["civil", "Civilní"],
                  ["standard", "Standard"]
                ]}
                value={publicFlightSymbolMode}
                onChange={(value) => onPublicFlightSymbolModeChange(value as PublicFlightSymbolMode)}
              />
              <p className="settings-help">Civilní režim používá oborové ikony pro lety, veřejnou dopravu a civilní vrstvy. Standard drží profesionální/NATO symboliku tam, kde je pro daný objekt dostupná.</p>
              <PanelTitle icon={<History size={17} />} title="Historie a predikce" />
              <label className="toggle-row">
                <input type="checkbox" checked={showHistory} onChange={(event) => onShowHistoryChange(event.target.checked)} />
                Historie trasy
              </label>
              <SegmentedControl
                label="Zobrazení historie"
                options={[
                  ["selected", "Vybraný"],
                  ["all", "Vše"]
                ]}
                value={trackHistoryDisplayMode}
                onChange={(value) => onTrackHistoryDisplayModeChange(value as TrackHistoryDisplayMode)}
              />
              <SegmentedControl
                label="Čas historie"
                options={historyWindowOptions.map((option) => [String(option), `${option}s`])}
                value={String(trackHistoryWindowSeconds)}
                onChange={(value) => onTrackHistoryWindowSecondsChange(Number(value))}
              />
              <SegmentedControl
                label="Bodový strop"
                options={historyLimitOptions.map((option) => [String(option), String(option)])}
                value={String(trackHistoryLimit)}
                onChange={(value) => onTrackHistoryLimitChange(Number(value))}
              />
              <label className="toggle-row">
                <input type="checkbox" checked={showPrediction} onChange={(event) => onShowPredictionChange(event.target.checked)} />
                Predikce pohybu
              </label>
              <SegmentedControl
                label="Režim predikce"
                options={predictionModeOptions}
                value={predictionMode}
                onChange={(value) => onPredictionModeChange(value as PredictionMode)}
              />
              <label className="range-label">
                Horizont predikce
                <input
                  type="range"
                  min="2"
                  max="20"
                  step="1"
                  value={predictionMinutes}
                  onChange={(event) => onPredictionMinutesChange(Number(event.target.value))}
                />
                <span>{predictionMinutes} min</span>
              </label>
            </section>
          ) : null}

          {activeTab === "data" ? (
            <section className="settings-section">
              <PanelTitle icon={<RefreshCw size={17} />} title="Fallback synchronizace" />
              <p className="settings-help">
                Primární zdroj živých dat je SSE stream. Tato synchronizace se používá při výpadku streamu, po obnově záložky a pro méně dynamická data.
              </p>
              <p className="settings-help">
                PWA režim ukládá aplikační shell a poslední povolený situační snapshot pro read-only zobrazení při výpadku spojení.
              </p>
              <label className="toggle-row">
                <input type="checkbox" checked={autoRefresh} onChange={(event) => onAutoRefreshChange(event.target.checked)} />
                Povolit fallback synchronizaci
              </label>
              <SegmentedControl
                label="Fallback interval"
                options={REFRESH_OPTIONS.map((option) => [String(option), `${option}s`])}
                value={String(refreshSeconds)}
                onChange={(value) => onRefreshSecondsChange(normalizeRefreshSeconds(Number(value)))}
              />
              <label className="toggle-row">
                <input type="checkbox" checked={includeSynthetic} onChange={(event) => onIncludeSyntheticChange(event.target.checked)} />
                Zobrazit simulovaná data
              </label>
              <label className="range-label">
                Minimum confidence
                <input type="range" min="0" max="1" step="0.05" value={minConfidence} onChange={(event) => onMinConfidenceChange(Number(event.target.value))} />
                <span>{Math.round(minConfidence * 100)} %</span>
              </label>
            </section>
          ) : null}

          {activeTab === "awareness" ? (
            <section className="settings-section">
              <PanelTitle icon={<MapPin size={17} />} title="Výstrahy a zóny" />
              <label className="toggle-row">
                <input type="checkbox" checked={proximityAlertEnabled} onChange={(event) => onProximityAlertEnabledChange(event.target.checked)} />
                Upozornit na rizika v okolí mojí polohy
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={showAlertAreas} onChange={(event) => onShowAlertAreasChange(event.target.checked)} />
                Zobrazit výstražné oblasti v mapě
              </label>
              <p className="settings-help">Výstražné oblasti jsou mapová vrstva pro rizika v okolí, uživatelské zóny a serverové události. Seznam výstrah zůstává dostupný i při vypnutém zobrazení v mapě.</p>
              <label className="range-label">
                Poloměr okolí
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={alertRadiusKm}
                  onChange={(event) => onAlertRadiusKmChange(Number(event.target.value))}
                />
                <span>{alertRadiusKm} km</span>
              </label>
              <div className="settings-subsection">
                <PanelTitle icon={<AlertTriangle size={17} />} title="Uživatelská zóna" />
                <label className="toggle-row">
                  <input type="checkbox" checked={Boolean(aoiRule?.enabled)} onChange={(event) => onAoiRuleEnabledChange(event.target.checked)} />
                  Upozornit na události ve zvolené zóně
                </label>
                <p className="settings-help">Zóna je osobní sledovaný prostor. Teď sleduje dostupná situační data a objekty; další krok je komunitní hlášení typu požár, foto a popis.</p>
                <label className="range-label">
                  Poloměr zóny
                  <input
                    type="range"
                    min="1"
                    max="80"
                    step="1"
                    value={Math.round(aoiRule?.radiusKm ?? 10)}
                    onChange={(event) => onAoiRuleRadiusKmChange(Number(event.target.value))}
                  />
                  <span>{Math.round(aoiRule?.radiusKm ?? 10)} km</span>
                </label>
                <div className="coordinate-readout">
                  <span>Střed zóny</span>
                  <strong>{formatAoiCenter(aoiRule)}</strong>
                </div>
                <div className="settings-button-row">
                  <button className="mini-button" onClick={onAoiRuleCenterFromMap} type="button">
                    Vytvořit ze středu mapy
                  </button>
                  <button className="mini-button" onClick={onAoiRuleCenterFromUserLocation} type="button">
                    Vytvořit z mojí polohy
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "account" ? (
            <section className="settings-section">
              <PanelTitle icon={<UserCircle size={17} />} title="Přihlášení" />
              <ReadinessRow label="Stav" value={authStatusLabel(authSession, authConfig)} tone={authSession.status === "authenticated" ? "ok" : "neutral"} />
              <ReadinessRow label="Profil" value={authSession.profile?.name ?? "nepřihlášen"} tone="neutral" />
              <ReadinessRow label="Veřejné čtení" value={authConfig.publicReadEnabled ? "zapnuto" : "vypnuto"} tone={authConfig.publicReadEnabled ? "ok" : "neutral"} />
              <ReadinessRow label="Serverový profil" value={profileSyncLabel(profileSyncStatus)} tone={profileSyncTone(profileSyncStatus)} />
              <ReadinessRow label="Uloženo" value={formatProfileUpdatedAt(serverProfileUpdatedAt)} tone="neutral" />
              {authConfig.publicReadEnabled && authSession.status !== "authenticated" ? (
                <div className="empty-mini">Mapa a veřejné vrstvy jsou dostupné bez přihlášení. Uživatelský profil, hlášení, potvrzení výstrah a AI asistent vyžadují účet.</div>
              ) : null}
              {isOidcEnabled(authConfig) ? (
                authSession.status === "authenticated" ? (
                  <button className="primary-button secondary" onClick={onLogout} type="button">
                    <LogOut size={16} />
                    Odhlásit
                  </button>
                ) : (
                  <button className="primary-button" onClick={onLogin} type="button">
                    <LogIn size={16} />
                    Přihlásit
                  </button>
                )
              ) : (
                <div className="empty-mini">Přihlášení není v této konfiguraci zapnuté. Aplikace běží v laboratorním režimu.</div>
              )}
              {profileSyncError ? <div className="error-banner">Profil: {profileSyncError}</div> : null}
              {authSession.error ? <div className="error-banner">Přihlášení: {authSession.error}</div> : null}
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function CatalogLayerMenu({
  activeGroup,
  coverageTechnology,
  getFeatureCount,
  getLayerStatus,
  groups,
  isLayerEnabled,
  isLayerOperable,
  loadError,
  statusLabel,
  onCloseDrawer,
  onCoverageTechnologyChange,
  onGroupSelect,
  onToggleLayer,
  onUserZoneColorChange,
  onUserZoneCreateFromMap,
  onUserZoneCreateFromUserLocation,
  onUserZoneDelete,
  onUserZoneEnabledChange,
  onUserZoneRadiusChange,
  onUserZoneStartDrawing,
  userZones,
  zoneCreationMode
}: {
  activeGroup: CatalogGroupView | null;
  coverageTechnology: CoverageTechnology;
  getFeatureCount: (layer: MapCatalogLayer) => number;
  getLayerStatus: (layer: MapCatalogLayer) => SituationLayerStatus;
  groups: CatalogGroupView[];
  isLayerEnabled: (layer: MapCatalogLayer) => boolean;
  isLayerOperable: (layer: MapCatalogLayer) => boolean;
  loadError: string | null;
  statusLabel: string;
  onCloseDrawer: () => void;
  onCoverageTechnologyChange: (technology: CoverageTechnology) => void;
  onGroupSelect: (groupId: string) => void;
  onToggleLayer: (layer: MapCatalogLayer) => void;
  onUserZoneColorChange: (zoneId: string, color: string) => void;
  onUserZoneCreateFromMap: () => void;
  onUserZoneCreateFromUserLocation: () => void;
  onUserZoneDelete: (zoneId: string) => void;
  onUserZoneEnabledChange: (zoneId: string, enabled: boolean) => void;
  onUserZoneRadiusChange: (zoneId: string, radiusKm: number) => void;
  onUserZoneStartDrawing: () => void;
  userZones: AoiRule[];
  zoneCreationMode: boolean;
}) {
  const activeLayerCount = groups.reduce((sum, view) => sum + view.layers.filter(isLayerEnabled).length, 0);
  return (
    <div className="catalog-layer-menu" data-testid="catalog-layer-rail">
      <div className="catalog-rail-status" title={`Režim ${statusLabel}`}>
        <Layers size={18} />
        <strong>{activeLayerCount}</strong>
      </div>
      <nav className="catalog-rail" aria-label="Katalog mapových vrstev">
        {groups.map((view) => {
          const enabledCount = view.layers.filter(isLayerEnabled).length;
          const isActive = activeGroup?.group.groupId === view.group.groupId;
          return (
            <button
              aria-label={view.group.label}
              aria-pressed={isActive}
              className={`catalog-rail-button ${isActive ? "active" : ""} ${enabledCount > 0 ? "has-enabled" : ""}`}
              key={view.group.groupId}
              onClick={() => onGroupSelect(view.group.groupId)}
              title={view.group.label}
              type="button"
            >
              {catalogGroupIcon(view.group.icon)}
              <span>{enabledCount > 0 ? enabledCount : view.layers.length}</span>
            </button>
          );
        })}
      </nav>
      {groups.length === 0 ? <div className="catalog-empty-state">Katalog se načítá</div> : null}
      {activeGroup ? (
        <CatalogLayerDrawer
          coverageTechnology={coverageTechnology}
          getFeatureCount={getFeatureCount}
          getLayerStatus={getLayerStatus}
          groupView={activeGroup}
          isLayerEnabled={isLayerEnabled}
          isLayerOperable={isLayerOperable}
          loadError={loadError}
          onClose={onCloseDrawer}
          onCoverageTechnologyChange={onCoverageTechnologyChange}
          onToggleLayer={onToggleLayer}
          onUserZoneColorChange={onUserZoneColorChange}
          onUserZoneCreateFromMap={onUserZoneCreateFromMap}
          onUserZoneCreateFromUserLocation={onUserZoneCreateFromUserLocation}
          onUserZoneDelete={onUserZoneDelete}
          onUserZoneEnabledChange={onUserZoneEnabledChange}
          onUserZoneRadiusChange={onUserZoneRadiusChange}
          onUserZoneStartDrawing={onUserZoneStartDrawing}
          userZones={userZones}
          zoneCreationMode={zoneCreationMode}
        />
      ) : null}
    </div>
  );
}

function CatalogLayerDrawer({
  coverageTechnology,
  getFeatureCount,
  getLayerStatus,
  groupView,
  isLayerEnabled,
  isLayerOperable,
  loadError,
  onClose,
  onCoverageTechnologyChange,
  onToggleLayer,
  onUserZoneColorChange,
  onUserZoneCreateFromMap,
  onUserZoneCreateFromUserLocation,
  onUserZoneDelete,
  onUserZoneEnabledChange,
  onUserZoneRadiusChange,
  onUserZoneStartDrawing,
  userZones,
  zoneCreationMode
}: {
  coverageTechnology: CoverageTechnology;
  getFeatureCount: (layer: MapCatalogLayer) => number;
  getLayerStatus: (layer: MapCatalogLayer) => SituationLayerStatus;
  groupView: CatalogGroupView;
  isLayerEnabled: (layer: MapCatalogLayer) => boolean;
  isLayerOperable: (layer: MapCatalogLayer) => boolean;
  loadError: string | null;
  onClose: () => void;
  onCoverageTechnologyChange: (technology: CoverageTechnology) => void;
  onToggleLayer: (layer: MapCatalogLayer) => void;
  onUserZoneColorChange: (zoneId: string, color: string) => void;
  onUserZoneCreateFromMap: () => void;
  onUserZoneCreateFromUserLocation: () => void;
  onUserZoneDelete: (zoneId: string) => void;
  onUserZoneEnabledChange: (zoneId: string, enabled: boolean) => void;
  onUserZoneRadiusChange: (zoneId: string, radiusKm: number) => void;
  onUserZoneStartDrawing: () => void;
  userZones: AoiRule[];
  zoneCreationMode: boolean;
}) {
  const enabledCount = groupView.layers.filter(isLayerEnabled).length;
  return (
    <section className="catalog-layer-drawer" data-testid="catalog-layer-drawer">
      <div className="catalog-drawer-header">
        <div>
          <span>Katalog vrstev</span>
          <strong>{groupView.group.label}</strong>
        </div>
        <button aria-label="Zavřít katalog vrstev" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </div>
      <div className="catalog-drawer-summary">
        <ReadinessRow label="Zapnuto" value={`${enabledCount}/${groupView.layers.length}`} tone={enabledCount > 0 ? "ok" : "neutral"} />
      </div>
      {loadError ? <div className="catalog-warning">API chyba: {loadError}</div> : null}
      <div className="catalog-layer-list">
        {groupView.layers.map((layer) => {
          const enabled = isLayerEnabled(layer);
          const operable = isLayerOperable(layer);
          const status = getLayerStatus(layer);
          return (
            <div className={`catalog-layer-row ${enabled ? "enabled" : ""} ${!operable ? "disabled" : ""}`} key={layer.layerId}>
              <label title={layer.description ?? layer.label}>
                <input checked={enabled} disabled={!operable} onChange={() => onToggleLayer(layer)} type="checkbox" />
                <span>
                  <strong>{layer.label}</strong>
                  <small>{catalogLayerHint(layer, operable)}</small>
                </span>
                <em>{getFeatureCount(layer)}</em>
              </label>
              <div className="catalog-layer-meta">
                <span className={`catalog-status ${status}`}>{situationStatusLabel(status)}</span>
                <span>{catalogLayerProviderLabel(layer)}</span>
              </div>
              {enabled && layer.filters?.some((filter) => filter.filterId === "technology") ? (
                <div className="catalog-technology-control" aria-label={`Technologie vrstvy ${layer.label}`}>
                  {coverageTechnologyOptions.map((technology) => (
                    <button
                      aria-pressed={coverageTechnology === technology}
                      className={coverageTechnology === technology ? "active" : ""}
                      key={technology}
                      onClick={() => onCoverageTechnologyChange(technology)}
                      type="button"
                    >
                      {technology}
                    </button>
                  ))}
                </div>
              ) : null}
              {layer.layerId === "user.zone.alerts" ? (
                <UserZoneLayerControls
                  creationMode={zoneCreationMode}
                  zones={userZones}
                  onColorChange={onUserZoneColorChange}
                  onCreateFromMap={onUserZoneCreateFromMap}
                  onCreateFromUserLocation={onUserZoneCreateFromUserLocation}
                  onDelete={onUserZoneDelete}
                  onEnabledChange={onUserZoneEnabledChange}
                  onRadiusChange={onUserZoneRadiusChange}
                  onStartMapClickCreation={onUserZoneStartDrawing}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LayerSourceTree({
  metrics,
  scopedObjects,
  selectedLayerIds,
  onToggleTrackLayer
}: {
  metrics: DashboardMetrics;
  scopedObjects: CopObject[];
  selectedLayerIds: CopLayer[];
  onToggleTrackLayer: (layerId: CopLayer) => void;
}) {
  const overallSelected = selectedLayerIds.includes("air-situation");
  const streams: Array<{ count: number; description: string; label: string; layerId: CopLayer }> = [
    { count: scopedObjects.length, description: "Všechny přijaté georeferencované tracky po aktivních filtrech.", label: "Celkový obraz", layerId: "air-situation" },
    { count: getSimulatedAirCount(scopedObjects), description: "Simulovaná letecká situace ze SIM track streamu.", label: "Simulace", layerId: "sim-air" },
    { count: getUavCount(scopedObjects), description: "Bezpilotní prostředky a UAV tracky.", label: "UAV", layerId: "uav" },
    { count: metrics.friendlyCount, description: "Vlastní a pravděpodobně vlastní objekty.", label: "Vlastní", layerId: "friendly" },
    { count: metrics.foreignCount, description: "Rizikové nebo neověřené objekty.", label: "Rizikové", layerId: "foreign" },
    { count: metrics.publicFlightCount, description: "Veřejná letová data ze SIM flight-data zdroje.", label: "Veřejné lety", layerId: "public-flights" },
    { count: getDataQualityCount(scopedObjects), description: "Tracky s nízkou confidence nebo datovou nejistotou.", label: "Kvalita dat", layerId: "data-quality" }
  ];

  return (
    <div className="layer-source-tree">
      <div className="layer-source-group">
        <div className="layer-source-header">
          <div>
            <strong>Air situation</strong>
            <span>{overallSelected ? "Celkový obraz bere všechny streamy" : `${selectedLayerIds.length} streamů zapnuto`}</span>
          </div>
          <small>{scopedObjects.length} tracků</small>
        </div>
        <div className="source-layer-grid">
          {streams.map((stream) => (
            <SourceLayerToggle
              checked={overallSelected || selectedLayerIds.includes(stream.layerId)}
              count={stream.count}
              description={stream.description}
              disabled={overallSelected && stream.layerId !== "air-situation"}
              key={stream.layerId}
              label={stream.label}
              onToggle={() => onToggleTrackLayer(stream.layerId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SourceLayerToggle({
  checked,
  count,
  description,
  disabled,
  label,
  onToggle
}: {
  checked: boolean;
  count: number;
  description: string;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <label className={`source-layer-toggle ${disabled ? "disabled" : ""}`} title={description}>
      <input checked={checked} disabled={disabled} onChange={onToggle} type="checkbox" />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <em>{count}</em>
    </label>
  );
}

function SituationLayerControls({
  coverageTechnology,
  featureCount,
  layers,
  sources,
  status,
  visibleLayerIds,
  visibleSourceIds,
  warnings,
  onCoverageTechnologyChange,
  onToggle,
  onToggleSource
}: {
  coverageTechnology: CoverageTechnology;
  featureCount: number;
  layers: SituationLayer[];
  sources: SituationSourceDescriptor[];
  status: SituationLayerStatus;
  visibleLayerIds: SituationLayerId[];
  visibleSourceIds: string[];
  warnings: string[];
  onCoverageTechnologyChange: (technology: CoverageTechnology) => void;
  onToggle: (layerId: SituationLayerId) => void;
  onToggleSource: (sourceId: string) => void;
}) {
  const layerItems = layers.length > 0 ? layers : defaultSituationLayers();
  const sourceItems = filterCitizenSituationSources(sources.filter((source) => !isSafetyOnlySituationSource(source)));
  const technicalSourceItems = filterTechnicalSituationSources(sources.filter((source) => !isSafetyOnlySituationSource(source)));
  const effectiveVisibleSourceIds = sanitizeCitizenSituationSourceIds(visibleSourceIds);
  const coverageEnabled = visibleLayerIds.includes("mobile_network");
  return (
    <div className="situation-layer-box">
      <div className="situation-layer-header">
        <PanelTitle icon={<Layers size={17} />} title="Situační kontext" />
        <span className={`situation-status ${status}`}>{situationStatusLabel(status)}</span>
      </div>
      <div className="situation-layer-grid">
        {layerItems.map((layer) => (
          <label className="situation-layer-toggle" key={layer.layerId} title={layer.description ?? layer.label}>
            <input
              checked={visibleLayerIds.includes(layer.layerId)}
              onChange={() => onToggle(layer.layerId)}
              type="checkbox"
            />
            <span>
              <strong>{situationLayerLabel(layer.layerId)}</strong>
              <small>{situationLayerHint(layer)}</small>
            </span>
          </label>
        ))}
      </div>
      {coverageEnabled ? (
        <div className="coverage-technology-control" aria-label="Technologie modelu mobilní sítě">
          <span>Mobilní síť</span>
          <div>
            {coverageTechnologyOptions.map((technology) => (
              <button
                className={coverageTechnology === technology ? "active" : ""}
                key={technology}
                onClick={() => onCoverageTechnologyChange(technology)}
                type="button"
              >
                {technology}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {sourceItems.length > 0 ? (
        <div className="situation-source-list">
          {sourceItems.map((source) => {
            const checked = effectiveVisibleSourceIds.length === 0 || effectiveVisibleSourceIds.includes(source.sourceId);
            const disabled = source.enabled === false;
            return (
              <label className={`situation-source-toggle ${disabled ? "disabled" : ""}`} key={source.sourceId} title={source.label ?? source.sourceId}>
                <input checked={!disabled && checked} disabled={disabled} onChange={() => onToggleSource(source.sourceId)} type="checkbox" />
                <span>
                  <strong>{source.label ?? source.sourceId}</strong>
                  <small>{formatSituationSourceHint(source)}</small>
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
      {technicalSourceItems.length > 0 ? (
        <div className="technical-source-list" aria-label="Technické vstupy mobilní sítě">
          <div className="technical-source-heading">
            <span>Technické vstupy</span>
            <small>diagnostika SIM, ne běžné vrstvy mapy</small>
          </div>
          {technicalSourceItems.map((source) => (
            <div className="technical-source-row" key={source.sourceId} title={source.label ?? source.sourceId}>
              <span>{source.label ?? source.sourceId}</span>
              <em>{source.enabled === false ? "vypnuto" : "běží"}</em>
            </div>
          ))}
        </div>
      ) : null}
      <ReadinessRow label="Features" value={String(featureCount)} tone={featureCount > 0 ? "ok" : "neutral"} />
      {warnings.slice(0, 2).map((warning) => (
        <div className="situation-warning" key={warning}>{warning}</div>
      ))}
    </div>
  );
}

function SafetyLayerControls({
  config,
  featureCount,
  layers,
  sources,
  status,
  visibleLayerIds,
  warnings,
  onToggle
}: {
  config: SafetyConfigResponse | null;
  featureCount: number;
  layers: SafetyLayer[];
  sources: SafetySourceDescriptor[];
  status: SituationLayerStatus;
  visibleLayerIds: SafetyLayerId[];
  warnings: string[];
  onToggle: (layerId: SafetyLayerId) => void;
}) {
  const layerItems = layers.length > 0 ? layers : defaultSafetyLayers();
  return (
    <div className="situation-layer-box safety-layer-box">
      <div className="situation-layer-header">
        <PanelTitle icon={<AlertTriangle size={17} />} title="Bezpečnostní data" />
        <span className={`situation-status ${status}`}>{situationStatusLabel(status)}</span>
      </div>
      <div className="situation-layer-grid">
        {layerItems.map((layer) => (
          <label className="situation-layer-toggle" key={layer.layerId} title={layer.description ?? layer.label}>
            <input
              checked={visibleLayerIds.includes(layer.layerId)}
              onChange={() => onToggle(layer.layerId)}
              type="checkbox"
            />
            <span>
              <strong>{safetyLayerLabel(layer.layerId)}</strong>
              <small>{safetyLayerHint(layer)}</small>
            </span>
          </label>
        ))}
      </div>
      <ReadinessRow label="Prvky" value={String(featureCount)} tone={featureCount > 0 ? "ok" : "neutral"} />
      <ReadinessRow label="Zdroje" value={formatSafetySources(sources, config)} tone={sources.some((source) => source.enabled) ? "ok" : "neutral"} />
      {warnings.slice(0, 2).map((warning) => (
        <div className="situation-warning" key={warning}>{warning}</div>
      ))}
    </div>
  );
}

function TakGatewayLayerControls({
  featureCount,
  layers,
  sources,
  status,
  visibleLayerIds,
  warnings,
  onToggle
}: {
  featureCount: number;
  layers: TakLayer[];
  sources: TakSourceDescriptor[];
  status: SituationLayerStatus;
  visibleLayerIds: TakLayerId[];
  warnings: string[];
  onToggle: (layerId: TakLayerId) => void;
}) {
  const layerItems = layers.length > 0 ? layers : defaultTakLayers();
  const sourceState = sources.some((source) => source.enabled !== false) ? "ok" : "neutral";
  return (
    <div className="situation-layer-box tak-layer-box">
      <div className="situation-layer-header">
        <PanelTitle icon={<RadioTower size={17} />} title="TAK Gateway" />
        <span className={`situation-status ${status}`}>{situationStatusLabel(status)}</span>
      </div>
      <div className="situation-layer-grid">
        {layerItems.map((layer) => (
          <label className="situation-layer-toggle" key={layer.layerId} title={layer.description ?? layer.label}>
            <input
              checked={visibleLayerIds.includes(layer.layerId)}
              onChange={() => onToggle(layer.layerId)}
              type="checkbox"
            />
            <span>
              <strong>{takLayerLabel(layer.layerId)}</strong>
              <small>{takLayerHint(layer)}</small>
            </span>
          </label>
        ))}
      </div>
      <ReadinessRow label="Prvky" value={String(featureCount)} tone={featureCount > 0 ? "ok" : "neutral"} />
      <ReadinessRow label="Zdroje" value={formatTakSources(sources)} tone={sourceState} />
      {warnings.slice(0, 2).map((warning) => (
        <div className="situation-warning" key={warning}>{warning}</div>
      ))}
    </div>
  );
}

function UserZoneLayerControls({
  creationMode,
  zones,
  onColorChange,
  onCreateFromMap,
  onCreateFromUserLocation,
  onDelete,
  onEnabledChange,
  onRadiusChange,
  onStartMapClickCreation
}: {
  creationMode: boolean;
  zones: AoiRule[];
  onColorChange: (zoneId: string, color: string) => void;
  onCreateFromMap: () => void;
  onCreateFromUserLocation: () => void;
  onDelete: (zoneId: string) => void;
  onEnabledChange: (zoneId: string, enabled: boolean) => void;
  onRadiusChange: (zoneId: string, radiusKm: number) => void;
  onStartMapClickCreation: () => void;
}) {
  const activeCount = zones.filter((zone) => zone.enabled).length;
  return (
    <div className="user-zone-layer-box">
      <div className="situation-layer-header">
        <PanelTitle icon={<MapPin size={17} />} title="Uživatelské zóny" />
        <span className={`situation-status ${activeCount > 0 ? "online" : "disabled"}`}>{activeCount > 0 ? `${activeCount} aktivní` : "vypnuto"}</span>
      </div>
      {zones.length === 0 ? <div className="empty-mini">Zapněte kreslení polygonu a klikáním do mapy vymezte vlastní zónu. Zóny se ukládají do profilu přihlášeného uživatele.</div> : null}
      <div className="user-zone-list">
        {zones.map((zone) => (
          <div className="user-zone-row" key={zone.id}>
            <label className="user-zone-main" title="Zapnutí zóny ji zobrazí v mapě a aktivuje výstrahu pro objekty uvnitř.">
              <input checked={zone.enabled} onChange={(event) => onEnabledChange(zone.id, event.target.checked)} type="checkbox" />
              <span style={{ background: normalizeAoiColor(zone.color) }} />
              <strong>{zone.name}</strong>
              <small>{formatAoiZoneGeometry(zone)} · {formatAoiCenter(zone)}</small>
            </label>
            <div className="zone-color-row" aria-label={`Barva zóny ${zone.name}`}>
              {zoneColorOptions.map((color) => (
                <button
                  aria-label={`Nastavit barvu ${color}`}
                  aria-pressed={normalizeAoiColor(zone.color) === color}
                  className={normalizeAoiColor(zone.color) === color ? "active" : ""}
                  key={color}
                  onClick={() => onColorChange(zone.id, color)}
                  style={{ background: color }}
                  type="button"
                />
              ))}
            </div>
            {zone.polygon ? null : (
              <label className="range-label compact">
                Poloměr
                <span>{Math.round(zone.radiusKm)} km</span>
                <input
                  max="80"
                  min="1"
                  onChange={(event) => onRadiusChange(zone.id, Number(event.target.value))}
                  step="1"
                  type="range"
                  value={Math.round(zone.radiusKm)}
                />
              </label>
            )}
            <button className="mini-button danger wide" onClick={() => onDelete(zone.id)} type="button">
              <Trash2 size={14} />
              Smazat
            </button>
          </div>
        ))}
      </div>
      <div className="zone-action-grid">
        <button className={`mini-button wide ${creationMode ? "active" : ""}`} onClick={onStartMapClickCreation} type="button">
          <MousePointer2 size={14} />
          {creationMode ? "Dokreslit v mapě" : "Kreslit polygon"}
        </button>
        <button className="mini-button wide" onClick={onCreateFromMap} type="button">
          <Plus size={14} />
          Střed mapy
        </button>
        <button className="mini-button wide" onClick={onCreateFromUserLocation} type="button">
          <MapPin size={14} />
          Moje poloha
        </button>
      </div>
    </div>
  );
}

function SegmentedControl({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: Array<[string, string]>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented-field">
      <span>{label}</span>
      <div className="segmented-control">
        {options.map(([optionValue, optionLabel]) => (
          <button
            aria-pressed={value === optionValue}
            className={value === optionValue ? "active" : ""}
            key={optionValue}
            onClick={() => onChange(optionValue)}
            type="button"
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function MapGlobalSearch({
  docked = false,
  isSearchingPlaces = false,
  placeSearchError = null,
  query,
  results,
  onChange,
  onClear,
  onDockChange,
  onSelect
}: {
  docked?: boolean;
  isSearchingPlaces?: boolean;
  query: string;
  placeSearchError?: string | null;
  results: MapSearchResult[];
  onChange: (value: string) => void;
  onClear: () => void;
  onDockChange: (docked: boolean) => void;
  onSelect: (result: MapSearchResult) => void;
}) {
  const hasQuery = query.trim().length > 0;
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const dragStateRef = React.useRef<MapSearchDragState | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [dockedExpanded, setDockedExpanded] = React.useState(false);
  const [position, setPosition] = React.useState<MapSearchPosition | null>(() => readMapSearchPosition());
  const collapsedDocked = docked && !dockedExpanded;

  const persistPosition = React.useCallback((nextPosition: MapSearchPosition | null) => {
    setPosition(nextPosition);
    writeMapSearchPosition(nextPosition);
  }, []);

  React.useEffect(() => {
    if (!docked) {
      setDockedExpanded(false);
    }
  }, [docked]);

  React.useEffect(() => {
    if (!isDragging) {
      return undefined;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      const nextPosition = clampMapSearchPosition({
        left: event.clientX - dragState.parentRect.left - dragState.offsetX,
        top: event.clientY - dragState.parentRect.top - dragState.offsetY,
        width: dragState.width
      }, dragState.parentRect);
      persistPosition(nextPosition);
    };
    const finishDrag = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag, { once: true });
    window.addEventListener("pointercancel", finishDrag, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [isDragging, persistPosition]);

  React.useEffect(() => {
    if (!position || docked) {
      return undefined;
    }
    const clampCurrentPosition = () => {
      const element = containerRef.current;
      const parent = element?.parentElement;
      if (!element || !parent) {
        return;
      }
      const parentRect = parent.getBoundingClientRect();
      const current = {
        left: element.offsetLeft,
        top: element.offsetTop,
        width: element.getBoundingClientRect().width
      };
      const clamped = clampMapSearchPosition(current, parentRect);
      if (Math.abs(clamped.left - current.left) > 1 || Math.abs(clamped.top - current.top) > 1 || Math.abs(clamped.width - position.width) > 1) {
        persistPosition(clamped);
      }
    };
    const animationFrame = window.requestAnimationFrame(clampCurrentPosition);
    window.addEventListener("resize", clampCurrentPosition);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", clampCurrentPosition);
    };
  }, [docked, persistPosition, position]);

  function startDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    const element = containerRef.current;
    const parent = element?.parentElement;
    if (!element || !parent) {
      return;
    }
    const elementRect = element.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    dragStateRef.current = {
      offsetX: event.clientX - elementRect.left,
      offsetY: event.clientY - elementRect.top,
      parentRect,
      width: Math.min(elementRect.width, Math.max(180, parentRect.width - 16))
    };
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function handleResultSelect(result: MapSearchResult) {
    onSelect(result);
    if (docked) {
      setDockedExpanded(false);
    }
  }

  return (
    <div
      className={`map-global-search ${docked ? "is-docked" : ""} ${collapsedDocked ? "is-collapsed" : ""} ${position && !docked ? "is-moved" : ""} ${isDragging ? "is-dragging" : ""}`}
      ref={containerRef}
      style={position && !docked ? {
        left: `${position.left}px`,
        right: "auto",
        top: `${position.top}px`,
        width: `min(${position.width}px, calc(100% - 16px))`
      } : undefined}
    >
      {collapsedDocked ? (
        <button className="map-global-search-launcher" type="button" onClick={() => setDockedExpanded(true)} aria-label="Otevřít hledání v mapě">
          <Search size={17} />
          <span>Hledání</span>
        </button>
      ) : (
        <>
      <div className="map-global-search-field">
        {docked ? (
          <span className="map-global-search-docked-mark" aria-hidden="true">
            <Pin size={15} />
          </span>
        ) : (
          <button
            aria-label="Přesunout hledání"
            className="map-global-search-drag"
            onPointerDown={startDrag}
            title="Přesunout hledání"
            type="button"
          >
            <Move size={15} />
          </button>
        )}
        <Search size={16} />
        <input
          aria-label="Hledat v mapě"
          autoComplete="off"
          placeholder="Hledat let, BTS, letiště, místo..."
          value={query}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <div className="map-global-search-actions">
        <button
          className="map-global-search-dock"
          type="button"
          aria-label={docked ? "Vrátit hledání nad mapu" : "Připnout hledání vlevo dole"}
          onClick={() => onDockChange(!docked)}
          title={docked ? "Vrátit nad mapu" : "Připnout vlevo dole"}
        >
          {docked ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
        {docked ? (
          <button className="map-global-search-reset" type="button" aria-label="Skrýt hledání" onClick={() => setDockedExpanded(false)} title="Skrýt hledání">
            <X size={15} />
          </button>
        ) : null}
        {position && !docked ? (
          <button className="map-global-search-reset" type="button" aria-label="Vrátit hledání na výchozí místo" onClick={() => persistPosition(null)}>
            <MousePointer2 size={15} />
          </button>
        ) : null}
        {hasQuery ? (
          <button className="map-global-search-clear" type="button" aria-label="Vymazat hledání v mapě" onClick={onClear}>
            <X size={15} />
          </button>
        ) : null}
      </div>
      {hasQuery ? (
        <div className="map-global-search-results" role="listbox" aria-label="Výsledky hledání v mapě">
          {results.length > 0 ? (
            results.map((result) => (
              <button className={`map-search-card map-search-card-${result.type}`} key={result.id} type="button" onClick={() => handleResultSelect(result)}>
                <span className="map-search-type">{result.typeLabel}</span>
                <span className="map-search-main">
                  <strong>{result.label}</strong>
                  <small>{result.subtitle || "Bez doplňujících metadat"}</small>
                </span>
                <MapPin size={15} />
              </button>
            ))
          ) : (
            <div className={`map-search-empty ${placeSearchError ? "map-search-empty-warning" : ""}`}>
              {isSearchingPlaces
                ? "Hledám místa..."
                : placeSearchError
                  ? "Vyhledávání míst je dočasně nedostupné."
                  : "Nic v aktuálních vrstvách ani v místech neodpovídá hledání."}
            </div>
          )}
          {results.length > 0 && placeSearchError ? (
            <div className="map-search-empty map-search-empty-warning">Vyhledávání míst je dočasně nedostupné.</div>
          ) : null}
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}

interface MapSearchPosition {
  left: number;
  top: number;
  width: number;
}

interface MapSearchDragState {
  offsetX: number;
  offsetY: number;
  parentRect: DOMRect;
  width: number;
}

const mapSearchPositionStorageKey = "cop.mapGlobalSearch.position.v1";
const mapSearchDockedStorageKey = "cop.mapGlobalSearch.docked.v1";

function readMapSearchPosition(): MapSearchPosition | null {
  try {
    const rawValue = window.localStorage.getItem(mapSearchPositionStorageKey);
    if (!rawValue) {
      return null;
    }
    const parsed = JSON.parse(rawValue) as Partial<MapSearchPosition>;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top) || !Number.isFinite(parsed.width)) {
      return null;
    }
    return {
      left: Number(parsed.left),
      top: Number(parsed.top),
      width: Number(parsed.width)
    };
  } catch {
    return null;
  }
}

function writeMapSearchPosition(position: MapSearchPosition | null) {
  try {
    if (!position) {
      window.localStorage.removeItem(mapSearchPositionStorageKey);
      return;
    }
    window.localStorage.setItem(mapSearchPositionStorageKey, JSON.stringify(position));
  } catch {
    // Non-critical personalization; ignore blocked or unavailable storage.
  }
}

function readMapSearchDocked(): boolean {
  try {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(mapSearchDockedStorageKey) === "true";
  } catch {
    return false;
  }
}

function writeMapSearchDocked(docked: boolean) {
  try {
    if (typeof window === "undefined") {
      return;
    }
    if (docked) {
      window.localStorage.setItem(mapSearchDockedStorageKey, "true");
    } else {
      window.localStorage.removeItem(mapSearchDockedStorageKey);
    }
  } catch {
    // Non-critical personalization; ignore blocked or unavailable storage.
  }
}

function clampMapSearchPosition(position: MapSearchPosition, parentRect: DOMRect): MapSearchPosition {
  const padding = 8;
  const width = Math.min(Math.max(180, position.width), Math.max(180, parentRect.width - padding * 2));
  return {
    left: clamp(position.left, padding, Math.max(padding, parentRect.width - width - padding)),
    top: clamp(position.top, padding, Math.max(padding, parentRect.height - 72)),
    width
  };
}

function ObjectSearchControl({
  compact = false,
  resultCount,
  totalCount,
  value,
  onChange
}: {
  compact?: boolean;
  resultCount: number;
  totalCount: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`object-search-control ${compact ? "compact" : ""}`}>
      <label className="search-field object-search-input">
        <Search size={15} />
        <input
          aria-label="Hledat v zobrazených objektech"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="ID, callsign, typ, zdroj..."
        />
      </label>
      {value.trim() ? (
        <button className="icon-button object-search-clear" type="button" aria-label="Vymazat hledání" onClick={() => onChange("")}>
          <X size={15} />
        </button>
      ) : null}
      <span className="object-search-count">{formatObjectSearchCount(resultCount, totalCount, value)}</span>
    </div>
  );
}

const objectColumnHelper = createColumnHelper<CopObject>();

function TrackTable({
  objects,
  selectedObjectId,
  onSelect
}: {
  objects: CopObject[];
  selectedObjectId?: string;
  onSelect: (objectId: string) => void;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const columns = React.useMemo(
    () => [
      objectColumnHelper.accessor((object) => formatObjectListLabel(object), {
        id: "label",
        header: "ID",
        cell: (info) => info.getValue()
      }),
      objectColumnHelper.accessor("objectType", {
        header: "Type",
        cell: (info) => info.getValue()
      }),
      objectColumnHelper.accessor("affiliation", {
        header: "Affiliation",
        cell: ({ row }) => {
          const affiliation = getAffiliationPresentation(row.original.affiliation);
          return (
            <>
              <i className={`affiliation-dot ${affiliation.disposition}`} />
              {row.original.affiliation}
            </>
          );
        }
      }),
      objectColumnHelper.accessor((object) => Math.round((object.confidence ?? 0) * 100), {
        id: "confidence",
        header: "Confidence",
        cell: (info) => `${info.getValue()} %`
      })
    ],
    []
  );
  const table = useReactTable({
    columns,
    data: objects,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (object) => object.objectId,
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting }
  });

  if (objects.length === 0) {
    return <div className="empty-state compact">Žádné objekty neodpovídají aktivním filtrům.</div>;
  }

  return (
    <div className="track-table" role="table" aria-label="Seznam situačních objektů">
      {table.getHeaderGroups().map((headerGroup) => (
        <div className="track-table-head" key={headerGroup.id} role="row">
          {headerGroup.headers.map((header) => {
            const sortState = header.column.getIsSorted();
            const sortLabel = sortState === "asc" ? "vzestupně" : sortState === "desc" ? "sestupně" : "bez řazení";
            const ariaSort = sortState === "asc" ? "ascending" : sortState === "desc" ? "descending" : "none";
            const label = flexRender(header.column.columnDef.header, header.getContext());
            const content = (
              <button
                aria-label={`Seřadit podle sloupce ${header.column.id}`}
                className={clsx("track-table-sort inline-flex items-center gap-1", sortState && "active")}
                disabled={!header.column.getCanSort()}
                onClick={header.column.getToggleSortingHandler()}
                type="button"
              >
                <span>{label}</span>
                <span aria-hidden="true" className="track-table-sort-indicator">
                  {sortState === "asc" ? "↑" : sortState === "desc" ? "↓" : "↕"}
                </span>
              </button>
            );
            return (
              <span aria-sort={ariaSort} key={header.id} role="columnheader">
                <Tooltip label={`Řazení: ${sortLabel}`}>{content}</Tooltip>
              </span>
            );
          })}
        </div>
      ))}
      {table.getRowModel().rows.slice(0, 10).map((row) => {
        const object = row.original;
        return (
          <button
            className={clsx("track-row", object.objectId === selectedObjectId && "selected")}
            key={object.objectId}
            onClick={() => onSelect(object.objectId)}
            aria-selected={object.objectId === selectedObjectId}
            role="row"
            type="button"
          >
            {row.getVisibleCells().map((cell) => (
              <span key={cell.id} title={cell.column.id === "label" ? object.objectId : undefined}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
}

function EventStream({ events }: { events: Array<{ id: string; title: string; detail: string; tone: string }> }) {
  return (
    <div className="event-stream">
      <div className="event-title">
        <Activity size={16} />
        Event stream
      </div>
      {events.length === 0 ? <div className="empty-mini">Bez událostí pro aktivní filtr.</div> : null}
      {events.map((event) => (
        <div className={`event-row ${event.tone}`} key={event.id}>
          <span />
          <div>
            <strong>{event.title}</strong>
            <small>{event.detail}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function ObjectDetail({
  historyPoints,
  object,
  replayActive,
  sourceHealth
}: {
  historyPoints: TrackHistory[string];
  object: CopObject;
  replayActive: boolean;
  sourceHealth: SourceHealthItem[];
}) {
  const model = React.useMemo(
    () => buildObjectDetailModel({ historyPoints, object, sourceHealth }),
    [historyPoints, object, sourceHealth]
  );
  const flightData = object.attributes?.flightData;

  return (
    <div className="object-detail">
      <div className="object-header">
        <div>
          <strong>{object.objectType}</strong>
          <span>{object.objectId}</span>
        </div>
        <em>{object.status}</em>
      </div>

      <ObjectDetailSection title="Identita">
        <DetailGrid
          rows={[
            ["Affiliation", <><span className={`affiliation-chip ${model.affiliation.disposition}`}>{model.affiliation.label}</span>{object.affiliation}</>],
            ["Domain", object.domain],
            ["Status", replayActive ? `${object.status} / replay` : object.status],
            ["Confidence", `${Math.round((object.confidence ?? 0) * 100)} %`]
          ]}
        />
      </ObjectDetailSection>

      <ObjectDetailSection title="Poloha">
        <DetailGrid
          rows={[
            ["Position", formatPosition(object)],
            ["Movement", formatMovement(object)],
            ["Age", formatAge(object.lastUpdatedAt)],
            ["History points", String(historyPoints.length)]
          ]}
        />
      </ObjectDetailSection>

      <ObjectDetailSection title="Symbologie">
        <DetailGrid
          rows={[
            ["NATO symbol", model.symbolCode],
            ["SIDC", model.sidc],
            ["Resolution", `${object.objectType} / ${object.affiliation} / ${object.status}`]
          ]}
        />
      </ObjectDetailSection>

      <ObjectDetailSection title="Zdroj">
        <DetailGrid
          rows={[
            ["Source", model.provenance?.sourceSystemId ?? "n/a"],
            ["Adapter", formatAdapter(model.provenance)],
            ["Producer time", formatShortDateTime(model.provenance?.producerTimestamp)],
            ["Ingest time", formatShortDateTime(model.provenance?.ingestTimestamp)],
            ["Latency", formatLatency(model.provenance?.latencyMs)],
            ["Reliability", formatReliability(model.provenance)]
          ]}
        />
      </ObjectDetailSection>

      {flightData ? (
        <ObjectDetailSection title="Flight data">
          <DetailGrid
            rows={[
              ["ICAO24", flightData.icao24 ?? "n/a"],
              ["Callsign", flightData.callsign ?? "n/a"],
              ["Registration", flightData.registration ?? "n/a"],
              ["Aircraft", formatFlightAircraft(flightData)],
              ["Origin", flightData.originCountry ?? "n/a"],
              ["Providers", formatFlightProviders(flightData)],
              ["License", formatFlightLicenses(flightData)],
              ["Quality", formatFlightQuality(flightData)]
            ]}
          />
        </ObjectDetailSection>
      ) : null}

      <ObjectDetailSection title="Confidence">
        <ConfidenceFactorList factors={model.confidenceFactors} />
      </ObjectDetailSection>

      <ObjectDetailSection title="Data lineage">
        <LineageList steps={model.lineage} />
      </ObjectDetailSection>

      <ObjectDetailSection title="Konflikty">
        <ConflictList conflicts={model.conflicts} />
      </ObjectDetailSection>

      <ObjectDetailSection title="Source history">
        <ObjectHistoryList history={model.history} />
      </ObjectDetailSection>

      <div className="object-flags">
        {object.synthetic ? <span className="synthetic-badge">SIM</span> : null}
        {isPublicFlightObject(object) ? <span className="public-flight-badge">PUBLIC FLIGHT</span> : null}
        {isMockFlightObject(object) ? <span className="warning-badge">MOCK</span> : null}
        {object.status === "STALE" || flightData?.quality?.stale ? <span className="warning-badge">STALE</span> : null}
        {(object.confidence ?? 0) < 0.5 ? <span className="warning-badge">LOW CONFIDENCE</span> : null}
        {model.conflicts.some((conflict) => conflict.severity === "warn") ? <span className="warning-badge">DATA CONFLICT</span> : null}
      </div>
    </div>
  );
}

function SituationFeatureDetail({
  feature,
  onDeleteReport,
  onEditReport,
  onOpenGallery
}: {
  feature: SituationFeature;
  onDeleteReport?: (reportId: string) => void;
  onEditReport?: (feature: SituationFeature) => void;
  onOpenGallery?: (
    attachments: NonNullable<SituationFeature["properties"]["attachments"]>,
    index: number,
    title: string,
    subtitle?: string
  ) => void;
}) {
  const properties = feature.properties;
  const status = situationFeatureStatusModel(feature);
  const isCommunityReport = properties.layer === "community" && typeof properties.reportId === "string";
  const trafficPresentation = properties.layer === "traffic" ? resolveTransportPresentation(feature) : null;
  const title = isMissionArenaFeature(feature)
    ? missionArenaDetailTitle(feature)
    : trafficPresentation
      ? [trafficPresentation.label, trafficPresentation.routeShortName].filter(Boolean).join(" ")
      : properties.headline ?? properties.label;
  return (
    <div className="object-detail situation-feature-detail">
      <div className="object-header">
        <div>
          <strong>{title}</strong>
          <span>{isCommunityReport ? [properties.groupName, properties.reportId].filter(Boolean).join(" · ") : properties.featureId}</span>
        </div>
        <div className="object-header-badges">
          <em>{properties.layer}</em>
          <StatusBadge label={status.label} tone={status.tone} />
        </div>
      </div>

      {isCommunityReport ? (
        <div className="community-report-actions">
          <button className="mini-button" onClick={() => onEditReport?.(feature)} type="button">Upravit</button>
          <button className="mini-button danger" onClick={() => onDeleteReport?.(properties.reportId as string)} type="button">Smazat</button>
        </div>
      ) : null}

      <ObjectDetailSection title="Kontext">
        <DetailGrid
          rows={[
            [isCommunityReport ? "Typ" : "Layer", isCommunityReport ? communityReportCategoryDisplay(properties.category) : situationLayerLabel(properties.layer)],
            [isCommunityReport ? "Skupina" : "Category", isCommunityReport ? properties.groupName ?? "bez skupiny" : properties.category],
            [isCommunityReport ? "Zdroj" : "Source", properties.sourceId],
            [isCommunityReport ? "Vloženo" : "Observed", formatShortDateTime(properties.observedAt)],
            [isCommunityReport ? "Platnost" : "Valid until", formatShortDateTime(properties.validUntil)],
            [isCommunityReport ? "Stáří" : "Age", formatAge(properties.observedAt)],
            [isCommunityReport ? "Riziko" : "Urgency", communitySeverityDisplay(properties.hazardSeverity ?? properties.severity ?? properties.urgency)],
            [isCommunityReport ? "Stav" : "Status", <StatusBadge key="status" label={status.label} tone={status.tone} />],
            ...(isCommunityReport ? [] : [
              ["Effective", formatShortDateTime(properties.effectiveAt)],
              ["Expires", formatShortDateTime(properties.expiresAt)],
              ["Confidence", formatOptionalPercent(properties.confidence)],
              ["Certainty", properties.certainty ?? "n/a"]
            ] as Array<[string, React.ReactNode]>)
          ]}
        />
      </ObjectDetailSection>

      {isMissionArenaFeature(feature) ? <MissionArenaSummary feature={feature} /> : null}

      {properties.layer === "mobile_coverage" || properties.layer === "mobile_network" ? (
        <ObjectDetailSection title={properties.layer === "mobile_network" ? "Mobilní síť" : "Mobilní pokrytí"}>
          <DetailGrid
            rows={[
              ["Model pokrytí", mobileNetworkModelLabel(properties)],
              ["Kvalita", mobileCoverageQualityModel(properties.quality).label],
              ["Stav", formatMobileNetworkStatus(properties.status)],
              ["Technologie", properties.technology ?? "n/a"],
              ["Operátor", properties.operator ?? "n/a"],
              ["Odhad signálu", formatOptionalNumber(properties.estimatedSignalDbm, " dBm")],
              ["Jistota", formatOptionalPercent(properties.confidence)],
              ["Kvalita dat", mobileNetworkDataQualityLabel(properties.dataQuality)],
              ["Shrnutí", properties.summary ?? "n/a"],
              ["Datové podklady", mobileNetworkBasisLabels(properties.basis)],
              ["Stav BTS", mobileNetworkBtsStatusNotice(properties.basis)],
              ["Poznámky", formatStringList(properties.notices)],
              ["Model", properties.modelVersion ?? "n/a"],
              ["Revize modelu", formatMobileNetworkSourceRevision(properties.sourceRevision)],
              ["Vygenerováno", formatShortDateTime(properties.generatedAt)],
              ["Rozlišení", formatOptionalNumber(properties.resolutionM, " m")],
              ["DEM", properties.demSource ?? "n/a"],
              ["Poznámka", properties.disclaimer ?? "n/a"]
            ]}
          />
        </ObjectDetailSection>
      ) : null}

      {isCommunicationTowerFeature(feature) ? (
        <ObjectDetailSection title="Komunikační stožár">
          <DetailGrid
            rows={[
              ["Typ", stringProperty(isRecord(properties.tags) ? properties.tags.towerType : undefined) ?? "communication"],
              ["OSM", formatOsmReference(isRecord(properties.tags) ? properties.tags : {})],
              ["Stav", formatCommunicationTowerStatus(properties.status)],
              ["Stav BTS", formatCommunicationTowerStatus(properties.btsStatus)],
              ["Operátorský stav", properties.operatorStatusAvailable ? "dostupný" : "není dostupný"],
              ["Poznámka", "Jde o referenční OSM infrastrukturu, ne potvrzený realtime stav operátora."]
            ]}
          />
        </ObjectDetailSection>
      ) : null}
      {properties.layer === "mobile" && !isCommunicationTowerFeature(feature) ? <MobileNetworkStatusSummary feature={feature} /> : null}
      {properties.layer === "traffic" ? <TrafficDetailSection feature={feature} /> : null}
      {isAviationWeatherFeature(feature) ? <AviationWeatherSummary feature={feature} /> : null}
      {properties.description || properties.recommendedAction ? (
        <ObjectDetailSection title="Popis">
          <DetailGrid
            rows={[
              ["Popis", properties.description ?? "n/a"],
              ["Doporučení", properties.recommendedAction ?? "n/a"]
            ]}
          />
        </ObjectDetailSection>
      ) : null}

      {properties.layer === "community" && properties.attachments && properties.attachments.length > 0 ? (
        <ObjectDetailSection title="Média">
          <CommunityAttachmentPreview
            attachments={properties.attachments}
            onOpenGallery={(attachments, index) => onOpenGallery?.(attachments, index, properties.label, properties.groupName ?? undefined)}
          />
        </ObjectDetailSection>
      ) : null}

      <ObjectDetailSection title="Poloha">
        <DetailGrid
          rows={[
            ["Geometry", feature.geometry.type],
            ["Coordinates", formatSituationCoordinates(feature)]
          ]}
        />
      </ObjectDetailSection>

      <ObjectDetailSection title="Metadata">
        <DetailGrid
          rows={[
            ["License", formatSituationRecord(properties.license)],
            ["Metrics", formatSituationRecord(properties.metrics)],
            ["Tags", formatSituationRecord(properties.tags)],
            ["Assumptions", formatSituationRecord(properties.assumptions)],
            ["Affected areas", formatStringList(properties.affectedAreas)],
            ["Geocodes", formatGeocodes(properties.geocodes)]
          ]}
        />
      </ObjectDetailSection>

      <div className="object-flags">
        <span className="situation-badge">CONTEXT</span>
        {isSafetyLayerId(properties.layer) ? <span className="warning-badge">SAFETY DATA</span> : null}
        {properties.stale ? <span className="warning-badge">STALE</span> : null}
        {properties.severity ? <span className="warning-badge">{properties.severity.toUpperCase()}</span> : null}
      </div>
    </div>
  );
}

function MissionArenaSummary({ feature }: { feature: SituationFeature }) {
  const properties = feature.properties;
  const story = isRecord(properties.story) ? properties.story : {};
  const role = missionArenaFeatureRole(feature);
  const task = missionArenaPrimaryTask(feature);
  const gameState = isRecord(properties.gameState) ? properties.gameState : {};
  const animation = isRecord(properties.animation) ? properties.animation : {};
  return (
    <>
      <ObjectDetailSection title="Mission Arena">
        <DetailGrid
          rows={[
            ["Role", role === "task_state" ? "Úkol role" : role === "team_state" ? "Stav týmu" : "Stav mise"],
            ["Mise", properties.missionId ?? "n/a"],
            ["Fáze", properties.phase ?? "n/a"],
            ["Režim", properties.runtimeMode ?? "n/a"],
            ["Balíček", properties.missionPackId ?? "n/a"],
            ["Integrace", properties.integrationMode ?? "presentation"],
            ["Účastníci", formatOptionalInteger(properties.participantCount)],
            ["Hlasování", formatOptionalInteger(properties.voteCount)],
            ["Tempo", stringProperty(gameState.tempo) ?? "n/a"],
            ["Tlak", formatOptionalNumber(numberProperty(gameState.pressure), "")],
            ["Vliv", formatOptionalNumber(numberProperty(gameState.influence), "")],
            ["Animace", stringProperty(animation.state) ?? "n/a"],
            ["Skóre", formatMissionArenaScore(properties.score)],
            ["Změna skóre", formatMissionArenaScore(properties.scoreDelta)],
            ["Tým", missionArenaTeamLabel(feature) ?? "n/a"],
            ["Týmové skóre", formatOptionalNumber(properties.aggregate, "")],
            ["Změna týmu", formatSignedOptionalNumber(properties.aggregateDelta)]
          ]}
        />
      </ObjectDetailSection>

      {task ? (
        <ObjectDetailSection title="Úkol">
          <DetailGrid
            rows={[
              ["Role", missionArenaRoleDisplayName(stringProperty(task.toRole)) ?? stringProperty(task.toRole) ?? "n/a"],
              ["Od", missionArenaRoleDisplayName(stringProperty(task.fromRole)) ?? stringProperty(task.fromRole) ?? "n/a"],
              ["Priorita", stringProperty(task.priority) ?? "n/a"],
              ["Stav", missionArenaTaskStatusLabel(stringProperty(task.status))],
              ["Text", stringProperty(task.label) ?? properties.label]
            ]}
          />
        </ObjectDetailSection>
      ) : null}

      {properties.teamScores && properties.teamScores.length > 0 ? (
        <ObjectDetailSection title="Týmy">
          <div className="mission-team-list">
            {properties.teamScores.slice(0, 8).map((team) => (
              <div className="mission-team-row" key={team.teamId}>
                <span className="mission-team-swatch" style={{ backgroundColor: team.color ?? "#9ca3af" }} />
                <strong>{team.label}</strong>
                <span>{team.rank ? `#${team.rank}` : "rank n/a"}</span>
                <span>{formatOptionalNumber(team.aggregate, "")}</span>
                <span>{formatSignedOptionalNumber(team.aggregateDelta)}</span>
              </div>
            ))}
          </div>
        </ObjectDetailSection>
      ) : null}

      {Object.keys(story).length > 0 ? (
        <ObjectDetailSection title="Scénář">
          <DetailGrid
            rows={[
              ["Akt", stringProperty(story.act) ?? "n/a"],
              ["Rozhodnutí", stringProperty(story.commanderDecision) ?? "n/a"],
              ["Tasking", stringProperty(story.roleTasking) ?? "n/a"],
              ["Vizualizace", stringProperty(story.visualization) ?? "n/a"]
            ]}
          />
        </ObjectDetailSection>
      ) : null}

      {properties.eventLog && properties.eventLog.length > 0 ? (
        <ObjectDetailSection title="Události">
          <div className="mission-event-list">
            {properties.eventLog.slice(0, 4).map((event, index) => (
              <div className="mission-event-row" key={stringProperty(event.eventId) ?? index}>
                <strong>{stringProperty(event.label) ?? "Událost"}</strong>
                <span>{[stringProperty(event.severity), formatShortDateTime(stringProperty(event.observedAt))].filter(Boolean).join(" · ")}</span>
              </div>
            ))}
          </div>
        </ObjectDetailSection>
      ) : null}
    </>
  );
}

function CommunityAttachmentPreview({
  attachments,
  onOpenGallery
}: {
  attachments: NonNullable<SituationFeature["properties"]["attachments"]>;
  onOpenGallery?: (attachments: NonNullable<SituationFeature["properties"]["attachments"]>, index: number) => void;
}) {
  return (
    <div className="community-media-list">
      {attachments.map((attachment, index) => {
        const spatialMode = attachment.kind === "video" ? communityAttachmentSpatialMode(attachment) : "none";
        const xrVideoUrl = buildXrVideoUrl(attachment);
        const xrDerivativeStatus = communityAttachmentXrDerivativeStatus(attachment);
        return (
          <div className="community-media-item" key={attachment.attachmentId}>
            <div className="community-media-meta">
              <strong>{attachment.fileName ?? communityAttachmentKindLabel(attachment.kind)}</strong>
              <span>{communityAttachmentKindLabel(attachment.kind)} · {formatFileSize(attachment.byteSize)}</span>
            </div>
            {attachment.contentUrl && attachment.kind === "photo" ? (
              <button className="community-media-open" onClick={() => onOpenGallery?.(attachments, index)} type="button">
                <img alt={attachment.fileName ?? "Fotografie hlášení"} src={attachment.contentUrl} />
              </button>
            ) : null}
            {attachment.contentUrl && attachment.kind === "video" ? (
              <>
                <button className="community-media-open" onClick={() => onOpenGallery?.(attachments, index)} type="button">
                  <video muted playsInline preload="metadata" src={attachment.contentUrl} />
                </button>
                <div className="community-media-actions">
                  <button className="mini-button community-document-link" onClick={() => onOpenGallery?.(attachments, index)} type="button">
                    Přehrát
                  </button>
                  <span className="community-spatial-badge">{communityAttachmentSpatialLabel(spatialMode)}</span>
                  {xrVideoUrl ? (
                    <a className="mini-button community-document-link" href={xrVideoUrl} target="_blank" rel="noreferrer">
                      Otevřít 3D v XR
                    </a>
                  ) : null}
                </div>
                {spatialMode === "apple_mv_hevc" ? (
                  <span className="community-video-note">
                    Originální iPhone spatial MOV je uložený beze změny. {xrDerivativeStatus ?? "3D XR kopie se připraví po uploadu."}
                  </span>
                ) : null}
              </>
            ) : null}
            {attachment.contentUrl && attachment.kind === "document" ? (
              <button className="mini-button community-document-link" onClick={() => onOpenGallery?.(attachments, index)} type="button">
                Otevřít PDF
              </button>
            ) : null}
            {!attachment.contentUrl ? (
              <span className="empty-mini">
                {attachment.accessDenied ? "Médium je dostupné jen oprávněným uživatelům nebo členům skupiny." : "Příloha zatím nemá dostupný náhled."}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ObjectDetailSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="object-detail-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="detail-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatFlightAircraft(flightData: FlightDataAttributes): string {
  const designator = recordString(flightData.aircraft, "typeDesignator") ?? recordString(flightData.aircraft, "designator");
  const manufacturer = recordString(flightData.aircraft, "manufacturer");
  const model = recordString(flightData.aircraft, "model");
  return [designator, manufacturer, model].filter(Boolean).join(" / ") || "n/a";
}

function formatFlightProviders(flightData: FlightDataAttributes): string {
  const providers = flightData.providers ?? [];
  if (providers.length > 0) {
    return providers.map((provider) => provider.label ?? formatFlightSourceId(provider.sourceId) ?? "unknown").join(", ");
  }
  const sourceIds = flightData.sources?.map((source) => source.sourceId).filter(Boolean) ?? [];
  return sourceIds.length > 0 ? sourceIds.map(formatFlightSourceId).join(", ") : "n/a";
}

function formatFlightLicenses(flightData: FlightDataAttributes): string {
  const providerLicenseNames = flightData.providers?.map((provider) => provider.licenseName).filter(Boolean) ?? [];
  if (providerLicenseNames.length > 0) {
    return providerLicenseNames.join(", ");
  }
  const licenseNames = flightData.providerLicenses?.map((license) => recordString(license, "name")).filter(Boolean) ?? [];
  return licenseNames.length > 0 ? licenseNames.join(", ") : "n/a";
}

function formatFlightQuality(flightData: FlightDataAttributes): string {
  const confidence = typeof flightData.quality?.confidence === "number" ? `${Math.round(flightData.quality.confidence * 100)} %` : "n/a";
  const stale = flightData.quality?.stale ? "stale" : "fresh";
  const age = typeof flightData.quality?.positionAgeSeconds === "number" ? `${flightData.quality.positionAgeSeconds}s` : "age n/a";
  return `${confidence} / ${stale} / ${age}`;
}

function isMockFlightObject(object: CopObject): boolean {
  const flightData = object.attributes?.flightData;
  return Boolean(
    flightData?.providers?.some((provider) => provider.sourceId === "mock" || provider.mode === "mock")
    || flightData?.sources?.some((source) => source.sourceId === "mock")
  );
}

function formatFlightSourceId(sourceId: string | undefined): string {
  const labels: Record<string, string> = {
    adsb_lol: "ADSB.lol",
    local_adsb: "Local ADS-B",
    mock: "SIM mock",
    opensky: "OpenSky"
  };
  return sourceId ? labels[sourceId] ?? sourceId : "unknown";
}

function recordString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const item = value?.[key];
  return typeof item === "string" && item.trim() !== "" ? item : undefined;
}

function ConfidenceFactorList({ factors }: { factors: ConfidenceFactor[] }) {
  return (
    <div className="confidence-factor-list">
      {factors.map((factor) => (
        <div className={`confidence-factor ${factor.tone}`} key={factor.label}>
          <span />
          <div>
            <strong>{factor.label}</strong>
            <small>{factor.detail}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function LineageList({ steps }: { steps: LineageStep[] }) {
  return (
    <ol className="lineage-list">
      {steps.map((step) => (
        <li key={step.label}>
          <span>{step.label}</span>
          <strong>{step.status}</strong>
          <small>{step.detail}</small>
        </li>
      ))}
    </ol>
  );
}

function ConflictList({ conflicts }: { conflicts: ObjectConflict[] }) {
  return (
    <div className="conflict-list">
      {conflicts.map((conflict) => (
        <div className={`conflict-row ${conflict.severity}`} key={conflict.title}>
          <AlertTriangle size={14} />
          <div>
            <strong>{conflict.title}</strong>
            <small>{conflict.detail}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function ObjectHistoryList({ history }: { history: ObjectHistoryEntry[] }) {
  if (history.length === 0) {
    return <div className="empty-mini">Temporal store zatím nemá body pro tento objekt.</div>;
  }

  return (
    <div className="object-history-list">
      {history.map((entry) => (
        <div className="object-history-row" key={`${entry.timestamp}-${entry.eventId ?? entry.sourceSystemId ?? "point"}`}>
          <strong>{formatShortDateTime(entry.timestamp)}</strong>
          <span>{entry.sourceSystemId ?? "source n/a"}</span>
          <small>
            {entry.status ?? "status n/a"} · {entry.confidence === undefined ? "confidence n/a" : `${Math.round(entry.confidence * 100)} %`} ·{" "}
            {entry.lat.toFixed(3)}, {entry.lon.toFixed(3)}
          </small>
        </div>
      ))}
    </div>
  );
}

function ReadinessRow({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "neutral" }) {
  return (
    <div className={`readiness-row ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function applyOperationalFilters(
  objects: CopObject[],
  affiliationScope: AffiliationScope,
  domainScope: DomainScope,
  searchQuery: string
): CopObject[] {
  return applyObjectSearch(objects.filter((object) => {
    if (affiliationScope !== "all" && getAffiliationPresentation(object.affiliation).disposition !== affiliationScope) {
      return false;
    }
    if (domainScope !== "all" && object.domain !== domainScope) {
      return false;
    }
    return true;
  }), searchQuery);
}

function applyObjectSearch(objects: CopObject[], searchQuery: string): CopObject[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return objects;
  }
  return objects.filter((object) => buildObjectSearchText(object).includes(normalizedQuery));
}

function buildObjectSearchText(object: CopObject): string {
  const flightData = object.attributes?.flightData;
  const provenance = object.attributes?.provenance;
  const values: unknown[] = [
    object.objectId,
    formatTrackLabel(object),
    object.objectType,
    object.affiliation,
    object.domain,
    object.status,
    flightData?.callsign,
    flightData?.registration,
    flightData?.icao24,
    flightData?.originCountry,
    flightData ? formatFlightAircraft(flightData) : undefined,
    flightData ? formatFlightProviders(flightData) : undefined,
    provenance?.sourceSystemId,
    provenance?.sourceDeviceId,
    object.position?.lat,
    object.position?.lon,
    object.attributes
  ];
  return collectSearchText(values).join(" ").toLowerCase();
}

function collectSearchText(value: unknown, depth = 0, output: string[] = []): string[] {
  if (output.length >= 80 || depth > 2 || value === null || value === undefined) {
    return output;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    value.slice(0, 12).forEach((item) => collectSearchText(item, depth + 1, output));
    return output;
  }
  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).slice(0, 24).forEach(([key, item]) => {
      output.push(key);
      collectSearchText(item, depth + 1, output);
    });
  }
  return output;
}

function formatObjectSearchCount(resultCount: number, totalCount: number, searchQuery: string): string {
  return searchQuery.trim() ? `${resultCount} z ${totalCount}` : `${totalCount} objektů`;
}

const communityReportCategoryOptions: Array<{ label: string; value: CommunityReportCategory }> = [
  { label: "Požár", value: "fire" },
  { label: "Povodeň", value: "flood" },
  { label: "Poškozený most", value: "bridge_damage" },
  { label: "Neprůjezdná komunikace", value: "road_blockage" },
  { label: "Poškozená infrastruktura", value: "infrastructure_damage" },
  { label: "Zdravotní událost", value: "medical" },
  { label: "Výpadek služby", value: "utility_outage" },
  { label: "Riziko v okolí", value: "hazard" },
  { label: "Jiné", value: "other" }
];

const communityHazardSeverityOptions: Array<{ label: string; value: CommunityReportHazardSeverity }> = [
  { label: "Informace", value: "advisory" },
  { label: "Varování", value: "warning" },
  { label: "Kritické", value: "critical" }
];

const communityMediaAccessOptions: Array<{ label: string; value: CommunityMediaAccessMode }> = [
  { label: "Všem", value: "public" },
  { label: "Jen mně", value: "private" },
  { label: "Vybraní uživatelé", value: "users" },
  { label: "Skupina", value: "groups" }
];

const communityGroupVisibilityOptions: Array<{ label: string; value: "private" | "public" }> = [
  { label: "S povolením vstupu", value: "private" },
  { label: "Veřejná", value: "public" }
];

function communityReportCategoryLabelForValue(category: CommunityReportCategory): string {
  return communityReportCategoryOptions.find((option) => option.value === category)?.label ?? "Hlášení";
}

function communityReportCategoryDisplay(category: unknown): string {
  return isCommunityReportCategoryValue(category) ? communityReportCategoryLabelForValue(category) : String(category ?? "Hlášení");
}

function communitySeverityDisplay(severity: unknown): string {
  if (severity === "critical") {
    return "Kritické";
  }
  if (severity === "warning") {
    return "Varování";
  }
  if (severity === "advisory" || severity === "info") {
    return "Informace";
  }
  return String(severity ?? "n/a");
}

function isCommunityReportCategoryValue(value: unknown): value is CommunityReportCategory {
  return communityReportCategoryOptions.some((option) => option.value === value);
}

function isCommunityHazardSeverityValue(value: unknown): value is CommunityReportHazardSeverity {
  return value === "advisory" || value === "warning" || value === "critical";
}

const communityVideoSpatialOptions: Array<{ label: string; value: CommunityVideoSpatialMode }> = [
  { label: "Běžné 2D video", value: "none" },
  { label: "iPhone prostorové MOV (uložit originál)", value: "apple_mv_hevc" },
  { label: "3D side-by-side", value: "side_by_side" },
  { label: "3D over-under", value: "over_under" }
];

function createCommunityReportDraft(location = resolveCommunityReportLocation(null, undefined)): CommunityReportDraft {
  return {
    category: "hazard",
    description: "",
    files: [],
    hazardSeverity: "warning",
    location,
    mediaLocationHint: "",
    mediaAccessGroupId: "",
    mediaAccessMode: "groups",
    mediaAccessUserSubjectIds: "",
    newGroupName: "",
    newGroupVisibility: "private",
    title: "",
    validUntil: toDateTimeLocalValue(new Date(Date.now() + 2 * 60 * 60 * 1000)),
    videoSpatialMode: "none"
  };
}

function resolveCommunityReportLocation(userLocation: UserLocation | null, mapView: MapViewState | undefined): CommunityReportLocation {
  if (userLocation) {
    return {
      ...(typeof userLocation.accuracyM === "number" ? { accuracyM: userLocation.accuracyM } : {}),
      lat: userLocation.lat,
      lon: userLocation.lon,
      source: "device"
    };
  }
  if (mapView) {
    return {
      lat: mapView.center[1],
      lon: mapView.center[0],
      source: "manual"
    };
  }
  return {
    lat: defaultAoiCenter.lat,
    lon: defaultAoiCenter.lon,
    source: "manual"
  };
}

function validateCommunityReportDraft(draft: CommunityReportDraft): string | null {
  if (!draft.title.trim()) {
    return "Doplňte název hlášení.";
  }
  if (!Number.isFinite(draft.location.lat) || !Number.isFinite(draft.location.lon)) {
    return "Hlášení musí mít polohu.";
  }
  if (!draft.validUntil || Number.isNaN(Date.parse(draft.validUntil))) {
    return "Doplňte odhadovanou platnost rizika.";
  }
  if (Date.parse(draft.validUntil) <= Date.now() - 60_000) {
    return "Platnost rizika musí být v budoucnosti.";
  }
  if (draft.mediaAccessMode === "groups" && !draft.mediaAccessGroupId && !draft.newGroupName.trim() && !draft.title.trim()) {
    return "Vyberte skupinu nebo doplňte název hlášení pro založení nové skupiny.";
  }
  if (draft.mediaAccessMode === "users" && parseSubjectIdList(draft.mediaAccessUserSubjectIds).length === 0) {
    return "Doplňte alespoň jednoho uživatele pro omezení přístupu k médiím.";
  }
  const unsupported = draft.files.find((file) => !communityAttachmentKindFromContentType(normalizeCommunityFileContentType(file)));
  if (unsupported) {
    return `Soubor ${unsupported.name || "bez názvu"} nemá podporovaný typ. Povolené jsou obrázky, PDF, MP4 a MOV.`;
  }
  return null;
}

function normalizeCommunityFileContentType(file: File): string {
  const type = file.type.toLowerCase();
  if (type) {
    return type;
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (name.endsWith(".png")) {
    return "image/png";
  }
  if (name.endsWith(".webp")) {
    return "image/webp";
  }
  if (name.endsWith(".heic")) {
    return "image/heic";
  }
  if (name.endsWith(".heif")) {
    return "image/heif";
  }
  if (name.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (name.endsWith(".mov")) {
    return "video/quicktime";
  }
  if (name.endsWith(".mp4")) {
    return "video/mp4";
  }
  return type;
}

function communityAttachmentKindFromContentType(contentType: string): CommunityAttachmentKind | null {
  if (contentType.startsWith("image/")) {
    return "photo";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  if (contentType === "application/pdf") {
    return "document";
  }
  return null;
}

function communityAttachmentKindLabel(kind: CommunityAttachmentKind | null): string {
  if (kind === "photo") {
    return "foto";
  }
  if (kind === "video") {
    return "video";
  }
  if (kind === "document") {
    return "PDF";
  }
  return "soubor";
}

function isCommunityVideoFile(file: File): boolean {
  return communityAttachmentKindFromContentType(normalizeCommunityFileContentType(file)) === "video";
}

function buildCommunityAttachmentMetadata(
  file: File,
  contentType: string,
  kind: CommunityAttachmentKind,
  videoSpatialMode: CommunityVideoSpatialMode,
  access: CommunityMediaAccessPolicy
): Record<string, unknown> | undefined {
  const accessMetadata = buildCommunityMediaAccessMetadata(access);
  if (kind !== "video") {
    return accessMetadata ? { access: accessMetadata } : undefined;
  }
  const stereoLayout = videoSpatialMode === "side_by_side" || videoSpatialMode === "over_under" ? videoSpatialMode : undefined;
  return {
    ...(accessMetadata ? { access: accessMetadata } : {}),
    spatialVideo: {
      browserPlayback: videoSpatialMode === "apple_mv_hevc" ? "2d_fallback" : stereoLayout ? "webxr_stereo" : "html5_2d",
      contentType,
      mode: videoSpatialMode,
      source: "user_declared",
      storage: "original",
      ...(stereoLayout ? { stereoLayout } : {})
    },
    uploadHint: {
      fileName: file.name || undefined,
      byteSize: file.size
    }
  };
}

function communityReportAccessPolicy(draft: CommunityReportDraft): CommunityMediaAccessPolicy {
  if (draft.mediaAccessMode === "groups") {
    return {
      audience: "groups",
      groupIds: draft.mediaAccessGroupId ? [draft.mediaAccessGroupId] : []
    };
  }
  if (draft.mediaAccessMode === "users") {
    return {
      audience: "users",
      userSubjectIds: parseSubjectIdList(draft.mediaAccessUserSubjectIds)
    };
  }
  return {
    audience: draft.mediaAccessMode
  };
}

function buildCommunityMediaAccessMetadata(access: CommunityMediaAccessPolicy): Record<string, unknown> | undefined {
  if (access.audience === "public") {
    return undefined;
  }
  return {
    audience: access.audience,
    ...(access.groupIds?.length ? { groupIds: access.groupIds } : {}),
    ...(access.userSubjectIds?.length ? { userSubjectIds: access.userSubjectIds } : {})
  };
}

function parseSubjectIdList(value: string): string[] {
  return Array.from(new Set(value
    .split(/[\s,;]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50)));
}

function communityMediaAccessLabel(mode: CommunityMediaAccessMode): string {
  switch (mode) {
    case "private":
      return "jen autor";
    case "users":
      return "vybraní uživatelé";
    case "groups":
      return "skupina";
    default:
      return "všem";
  }
}

function communityAttachmentSpatialMode(attachment: { metadata?: Record<string, unknown> }): CommunityVideoSpatialMode {
  const maybeSpatialVideo = attachment.metadata?.spatialVideo;
  const spatialVideo = isPlainObject(maybeSpatialVideo) ? maybeSpatialVideo : undefined;
  const mode = spatialVideo && typeof spatialVideo.mode === "string" ? spatialVideo.mode : "none";
  return mode === "apple_mv_hevc" || mode === "over_under" || mode === "side_by_side" ? mode : "none";
}

function communityAttachmentSpatialLabel(mode: CommunityVideoSpatialMode): string {
  switch (mode) {
    case "apple_mv_hevc":
      return "iPhone Spatial MOV";
    case "side_by_side":
      return "3D side-by-side";
    case "over_under":
      return "3D over-under";
    default:
      return "2D video";
  }
}

function communityAttachmentXrDerivativeStatus(attachment: { derivatives?: NonNullable<SituationFeature["properties"]["attachments"]>[number]["derivatives"] }): string | null {
  const derivative = attachment.derivatives?.find((item) => item.derivativeId === "xr-sbs");
  if (!derivative) {
    return null;
  }
  switch (derivative.status) {
    case "queued":
      return "XR kopie čeká ve frontě";
    case "processing":
      return "XR kopie se připravuje";
    case "ready":
      return "XR kopie připravena";
    case "failed":
      return derivative.error ? `XR konverze selhala: ${derivative.error}` : "XR konverze selhala";
    default:
      return null;
  }
}

function buildXrVideoUrl(attachment: NonNullable<SituationFeature["properties"]["attachments"]>[number]): string | null {
  if (attachment.kind !== "video") {
    return null;
  }
  const xrDerivative = attachment.derivatives?.find((derivative) =>
    derivative.derivativeId === "xr-sbs" && derivative.status === "ready" && derivative.contentUrl
  );
  if (xrDerivative?.contentUrl) {
    const params = new URLSearchParams({
      layout: "side_by_side",
      media: xrDerivative.contentUrl,
      title: attachment.fileName ?? "Komunitní 3D video"
    });
    return `/xr?${params.toString()}`;
  }
  if (!attachment.contentUrl) {
    return null;
  }
  const mode = communityAttachmentSpatialMode(attachment);
  if (mode !== "side_by_side" && mode !== "over_under") {
    return null;
  }
  const params = new URLSearchParams({
    layout: mode,
    media: attachment.contentUrl,
    title: attachment.fileName ?? "Komunitní video"
  });
  return `/xr?${params.toString()}`;
}

function buildCommunityGalleryAttachments(
  collection: CommunityFeatureCollectionResponse | null,
  feature: SituationFeature,
  fallbackAttachments: NonNullable<SituationFeature["properties"]["attachments"]>
): NonNullable<SituationFeature["properties"]["attachments"]> {
  const groupId = typeof feature.properties.groupId === "string" ? feature.properties.groupId : undefined;
  if (!groupId || !collection) {
    return fallbackAttachments;
  }
  const byId = new Map<string, NonNullable<SituationFeature["properties"]["attachments"]>[number]>();
  for (const item of collection.features) {
    if (item.properties.layer !== "community" || item.properties.groupId !== groupId) {
      continue;
    }
    for (const attachment of item.properties.attachments ?? []) {
      byId.set(attachment.attachmentId, attachment);
    }
  }
  return byId.size > 0 ? Array.from(byId.values()) : fallbackAttachments;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function firstMediaLocation(files: File[]): Promise<{ fileName: string; location: CommunityReportLocation } | null> {
  for (const file of files) {
    const contentType = normalizeCommunityFileContentType(file);
    const location = contentType === "image/jpeg"
      ? await extractJpegExifLocation(file)
      : contentType === "video/quicktime" || contentType === "video/mp4"
        ? await extractIso6709VideoLocation(file)
        : null;
    if (location) {
      return {
        fileName: file.name || "médium",
        location
      };
    }
  }
  return null;
}

async function extractJpegExifLocation(file: File): Promise<CommunityReportLocation | null> {
  const buffer = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return null;
  }
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      return null;
    }
    const marker = view.getUint8(offset + 1);
    const length = view.getUint16(offset + 2, false);
    if (marker === 0xe1 && offset + 4 + length <= view.byteLength) {
      return readExifGpsLocation(view, offset + 4, length - 2);
    }
    offset += 2 + Math.max(length, 2);
  }
  return null;
}

function readExifGpsLocation(view: DataView, offset: number, length: number): CommunityReportLocation | null {
  if (length < 14 || readAscii(view, offset, 6) !== "Exif\u0000\u0000") {
    return null;
  }
  const tiff = offset + 6;
  const littleEndian = readAscii(view, tiff, 2) === "II";
  const readU16 = (position: number) => view.getUint16(position, littleEndian);
  const readU32 = (position: number) => view.getUint32(position, littleEndian);
  if (readU16(tiff + 2) !== 42) {
    return null;
  }
  const ifd0 = tiff + readU32(tiff + 4);
  const gpsIfdOffset = readIfdValueOffset(view, ifd0, 0x8825, littleEndian, tiff, offset + length);
  if (!gpsIfdOffset) {
    return null;
  }
  const gps = readGpsIfd(view, gpsIfdOffset, littleEndian, tiff, offset + length);
  if (!gps) {
    return null;
  }
  return {
    lat: gps.lat,
    lon: gps.lon,
    source: "photo_exif"
  };
}

function readIfdValueOffset(view: DataView, ifdOffset: number, tag: number, littleEndian: boolean, tiff: number, maxOffset: number): number | null {
  if (ifdOffset + 2 > maxOffset) {
    return null;
  }
  const count = view.getUint16(ifdOffset, littleEndian);
  for (let index = 0; index < count; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    if (entry + 12 > maxOffset) {
      return null;
    }
    if (view.getUint16(entry, littleEndian) === tag) {
      return tiff + view.getUint32(entry + 8, littleEndian);
    }
  }
  return null;
}

function readGpsIfd(view: DataView, gpsIfdOffset: number, littleEndian: boolean, tiff: number, maxOffset: number): { lat: number; lon: number } | null {
  if (gpsIfdOffset + 2 > maxOffset) {
    return null;
  }
  const count = view.getUint16(gpsIfdOffset, littleEndian);
  let latRef = "N";
  let lonRef = "E";
  let lat: number[] | null = null;
  let lon: number[] | null = null;
  for (let index = 0; index < count; index += 1) {
    const entry = gpsIfdOffset + 2 + index * 12;
    if (entry + 12 > maxOffset) {
      return null;
    }
    const tag = view.getUint16(entry, littleEndian);
    const type = view.getUint16(entry + 2, littleEndian);
    const values = view.getUint32(entry + 4, littleEndian);
    const valueOffset = tiff + view.getUint32(entry + 8, littleEndian);
    if (tag === 1 && type === 2) {
      latRef = String.fromCharCode(view.getUint8(entry + 8));
    } else if (tag === 3 && type === 2) {
      lonRef = String.fromCharCode(view.getUint8(entry + 8));
    } else if (tag === 2 && type === 5 && values >= 3) {
      lat = readExifRationals(view, valueOffset, 3, littleEndian, maxOffset);
    } else if (tag === 4 && type === 5 && values >= 3) {
      lon = readExifRationals(view, valueOffset, 3, littleEndian, maxOffset);
    }
  }
  if (!lat || !lon) {
    return null;
  }
  return {
    lat: dmsToDecimal(lat, latRef),
    lon: dmsToDecimal(lon, lonRef)
  };
}

function readExifRationals(view: DataView, offset: number, count: number, littleEndian: boolean, maxOffset: number): number[] | null {
  if (offset + count * 8 > maxOffset) {
    return null;
  }
  return Array.from({ length: count }, (_, index) => {
    const numerator = view.getUint32(offset + index * 8, littleEndian);
    const denominator = view.getUint32(offset + index * 8 + 4, littleEndian);
    return denominator === 0 ? 0 : numerator / denominator;
  });
}

function dmsToDecimal(parts: number[], ref: string): number {
  const [degrees = 0, minutes = 0, seconds = 0] = parts;
  const value = degrees + minutes / 60 + seconds / 3600;
  return ref === "S" || ref === "W" ? -value : value;
}

async function extractIso6709VideoLocation(file: File): Promise<CommunityReportLocation | null> {
  const slices = [
    file.slice(0, Math.min(file.size, 2 * 1024 * 1024)),
    file.size > 2 * 1024 * 1024 ? file.slice(Math.max(0, file.size - 2 * 1024 * 1024)) : null
  ].filter(Boolean) as Blob[];
  const decoder = new TextDecoder("latin1");
  for (const slice of slices) {
    const text = decoder.decode(await slice.arrayBuffer());
    const match = /([+-]\d{2,3}\.\d{3,})([+-]\d{3}\.\d{3,})(?:[+-]\d+(?:\.\d+)?)?\/?/u.exec(text);
    if (match) {
      const lat = Number(match[1]);
      const lon = Number(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon, source: "media_metadata" };
      }
    }
  }
  return null;
}

function readAscii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join("");
}

function formatReportLocation(location: CommunityReportLocation): string {
  const sourceLabel: Record<CommunityReportLocation["source"], string> = {
    device: "GPS",
    manual: "mapa",
    media_metadata: "médium",
    photo_exif: "fotka",
    unknown: "neznámé"
  };
  return `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)} · ${sourceLabel[location.source]}`;
}

function uploadProgressFromAttachment(
  file: File,
  fileIndex: number,
  fileCount: number,
  progress: CommunityAttachmentUploadProgress
): CommunityUploadUiState {
  const totalBytes = progress.lengthComputable && progress.total > 0 ? progress.total : file.size || 1;
  return {
    fileCount,
    fileIndex: fileIndex + 1,
    fileName: file.name || "Příloha",
    loadedBytes: Math.min(progress.loaded, totalBytes),
    phase: progress.phase,
    totalBytes
  };
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} kB`;
  }
  return `${bytes} B`;
}

function toDateTimeLocalValue(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatObjectListLabel(object: CopObject): string {
  const label = formatTrackLabel(object);
  return label || object.objectId;
}

function buildMetrics(objects: CopObject[], sources: SourceSystem[]): DashboardMetrics {
  const confidenceValues = objects.map((object) => object.confidence ?? 0);
  const avgConfidence = confidenceValues.length
    ? Math.round((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) * 100)
    : 0;
  const lowConfidenceCount = getDataQualityCount(objects);
  const foreignCount = objects.filter((object) => getAffiliationPresentation(object.affiliation).disposition === "hostile").length;
  const friendlyCount = objects.filter((object) => getAffiliationPresentation(object.affiliation).disposition === "friend").length;
  return {
    activeSources: sources.filter((source) => source.status === "ACTIVE").length,
    avgConfidence,
    foreignCount,
    friendlyCount,
    lowConfidenceCount,
    publicFlightCount: getPublicFlightCount(objects),
    syntheticCount: objects.filter((object) => object.synthetic).length,
    warningCount: lowConfidenceCount + objects.filter((object) => object.status === "LOST" || object.status === "STALE").length
  };
}

function summarizeAlerts(serverAlerts: CopAlert[], proximityAlerts: ProximityAlert[]): AlertSummary {
  return {
    critical: serverAlerts.filter((alert) => alert.severity === "critical").length + proximityAlerts.filter((alert) => alert.type === "inside-radius").length,
    local: proximityAlerts.length,
    server: serverAlerts.length,
    total: serverAlerts.length + proximityAlerts.length,
    warning: serverAlerts.filter((alert) => alert.severity === "warning").length + proximityAlerts.filter((alert) => alert.type === "approaching").length
  };
}

function mergeSituationSafetyFlightCommunityMissionAndTakFeatures(
  situation: SituationFeatureCollectionResponse | null,
  safety: SafetyFeatureCollectionResponse | null,
  flight: FlightReferenceFeatureCollectionResponse | null,
  community: CommunityFeatureCollectionResponse | null,
  missionArena: MissionArenaFeatureCollectionResponse | null,
  tak: TakFeatureCollectionResponse | null
): SituationFeatureCollectionResponse | null {
  if (!situation && !safety && !flight && !community && !missionArena && !tak) {
    return null;
  }
  const situationFeatures = situation?.features ?? [];
  const safetyFeatures = safety?.features.map(safetyFeatureToSituationFeature) ?? [];
  const flightReferenceFeatures = flight?.features ?? [];
  const communityReportFeatures = community?.features ?? [];
  const missionArenaFeatures = missionArena?.features.map(missionArenaFeatureToSituationFeature) ?? [];
  const takGatewayFeatures = tak?.features.map(takFeatureToSituationFeature) ?? [];
  const features = [...situationFeatures, ...safetyFeatures, ...flightReferenceFeatures, ...communityReportFeatures, ...missionArenaFeatures, ...takGatewayFeatures];
  const warnings = [...(situation?.warnings ?? []), ...(safety?.warnings ?? []), ...(flight?.warnings ?? []), ...(community?.warnings ?? []), ...(missionArena?.warnings ?? []), ...(tak?.warnings ?? [])];
  return {
    contractVersion: "cop-situation-source-v1",
    features,
    generatedAt: latestTimestamp([situation?.generatedAt, safety?.generatedAt, flight?.generatedAt, community?.generatedAt, missionArena?.generatedAt, tak?.generatedAt]) ?? new Date().toISOString(),
    query: {
      bbox: situation?.query.bbox ?? safety?.query.bbox ?? flight?.query.bbox ?? community?.query?.bbox ?? missionArena?.query.bbox ?? tak?.query.bbox ?? { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
      layers: [
        ...(situation?.query.layers ?? []),
        ...((safety?.query.layers ?? []) as SituationLayerId[]),
        ...flightReferenceQueryLayersToSituationLayers(flight?.query.layers ?? []),
        ...(community ? ["community" as SituationLayerId] : []),
        ...(missionArena ? ["mission_arena" as SituationLayerId] : []),
        ...((tak?.query.layers ?? []) as SituationLayerId[])
      ],
      limit: Math.max(situation?.query.limit ?? 0, safety?.query.limit ?? 0, flight?.query.limit ?? 0, community?.query?.limit ?? 0, missionArena?.query.limit ?? 0, tak?.query.limit ?? 0, 250)
    },
    source: {
      generatedAt: latestTimestamp([situation?.source.generatedAt, safety?.source.generatedAt, flight?.source.generatedAt, community?.source.generatedAt, missionArena?.source.generatedAt, tak?.source.generatedAt]),
      sourceId: "situation-data-api",
      sourceType: "PUBLIC_SITUATION_AGGREGATE"
    },
    sourceHealth: situation?.sourceHealth ?? safety?.sourceHealth ?? flight?.sourceHealth ?? missionArena?.sourceHealth ?? tak?.sourceHealth,
    sources: [
      ...(situation?.sources ?? []),
      ...((safety?.sources ?? []).map((source) => ({
        ...source,
        layers: source.layers as SituationLayerId[]
      }))),
      ...((flight?.sources ?? []).map((source) => ({
        ...source,
        label: source.label ? `Flight data > ${source.label}` : "Flight data",
        layers: flightReferenceQueryLayersToSituationLayers(source.layers ?? [])
      }))),
      ...(community ? [{
        enabled: true,
        label: "Komunitní hlášení",
        layers: ["community" as SituationLayerId],
        sourceId: "community_reports"
      }] : []),
      ...(missionArena ? [{
        enabled: true,
        label: "Mission Arena",
        layers: ["mission_arena" as SituationLayerId],
        sourceId: "mission_arena_runtime"
      }] : []),
      ...((tak?.sources ?? []).map((source) => ({
        ...source,
        label: source.label ? `TAK Gateway > ${source.label}` : "TAK Gateway",
        layers: source.layers as SituationLayerId[]
      })))
    ],
    summary: {
      featureCount: features.length,
      sourceCount: (situation?.summary.sourceCount ?? 0) + (safety?.summary.sourceCount ?? 0) + (flight?.summary.sourceCount ?? 0) + (community ? 1 : 0) + (missionArena?.summary.sourceCount ?? 0) + (tak?.summary.sourceCount ?? 0),
      staleFeatureCount: features.filter((feature) => feature.properties.stale).length,
      warningCount: (situation?.summary.warningCount ?? 0) + (safety?.summary.warningCount ?? 0) + (safety?.summary.criticalCount ?? 0) + (flight?.summary.warningCount ?? 0) + (community?.warnings?.length ?? 0) + (missionArena?.summary.warningCount ?? 0) + (tak?.summary.warningCount ?? 0)
    },
    type: "FeatureCollection",
    warnings
  };
}

function safetyFeatureToSituationFeature(feature: SafetyFeature): SituationFeature {
  return {
    geometry: feature.geometry,
    id: feature.id,
    properties: {
      ...feature.properties,
      label: feature.properties.headline,
      tags: {
        ...(isRecord(feature.properties.tags) ? feature.properties.tags : {}),
        dataSource: "safety-data"
      }
    },
    type: "Feature"
  };
}

function missionArenaFeatureToSituationFeature(feature: SituationFeature): SituationFeature {
  return {
    geometry: feature.geometry,
    id: feature.id,
    properties: {
      ...feature.properties,
      layer: "mission_arena",
      tags: {
        ...(isRecord(feature.properties.tags) ? feature.properties.tags : {}),
        dataSource: "mission-arena"
      }
    },
    type: "Feature"
  };
}

function flightReferenceQueryLayersToSituationLayers(layers: string[]): SituationLayerId[] {
  return layers.flatMap((layer): SituationLayerId[] => {
    if (layer === "flight.airports" || layer === "flight_airports") {
      return ["flight_airports"];
    }
    if (layer === "flight.airspaces" || layer === "flight_airspaces") {
      return ["flight_airspaces"];
    }
    return [];
  });
}

function flightReferenceLayerIdForStream(streamId: string | undefined): string | undefined {
  if (streamId === "airports") {
    return "flight.airports";
  }
  if (streamId === "airspaces") {
    return "flight.airspaces";
  }
  return undefined;
}

function takFeatureToSituationFeature(feature: TakFeature): SituationFeature {
  return {
    geometry: feature.geometry,
    id: feature.id,
    properties: {
      ...feature.properties,
      tags: {
        ...(isRecord(feature.properties.tags) ? feature.properties.tags : {}),
        dataSource: "tak-gateway",
        takLayer: feature.properties.layer
      }
    },
    type: "Feature"
  };
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .reduce<string | undefined>((latest, value) => {
      if (!latest) {
        return value;
      }
      return Date.parse(value) > Date.parse(latest) ? value : latest;
    }, undefined);
}

function buildMapEmptyMessage({
  contextLayersEnabled,
  loadError,
  objects,
  replayActive,
  scopedObjects,
  sources,
  visibleObjects
}: {
  contextLayersEnabled: boolean;
  loadError: string | null;
  objects: CopObject[];
  replayActive: boolean;
  scopedObjects: CopObject[];
  sources: SourceSystem[];
  visibleObjects: CopObject[];
}): string {
  if (loadError) {
    return `API situační mapy není dostupné: ${loadError}`;
  }
  if (replayActive && objects.length === 0) {
    return "Zvolený čas replaye neobsahuje žádné tracky. Posuň časovou osu nebo přepni zpět na live.";
  }
  if (objects.length > 0 && visibleObjects.length === 0) {
    if (contextLayersEnabled) {
      return "Track streamy jsou vypnuté nebo neodpovídají filtrům; mapa může dál zobrazovat vybrané kontextové vrstvy.";
    }
    return scopedObjects.length > 0
      ? "Zapnuté track streamy neobsahují žádné objekty. Změň výběr streamů nebo zapni kontextové vrstvy."
      : "Aktivní filtry skrývají všechny přijaté objekty.";
  }
  if (hasActiveSimSource(sources)) {
    return "SIM zdroj je připojený, ale mapa nemá žádné aktivní georeferencované objekty. Spusť scénář v SIM.";
  }
  if (sources.length > 0) {
    return "Source Registry je dostupný, ale zatím nejsou přijaty aktivní georeferencované tracky.";
  }
  return "Čekám na georeferencované situační objekty.";
}

function hasActiveSimSource(sources: SourceSystem[]): boolean {
  return sources.some((source) => {
    const sourceId = source.sourceSystemId.toLowerCase();
    const name = source.displayName.toLowerCase();
    return source.status === "ACTIVE" && (source.synthetic || sourceId.includes("sim") || name.includes("sim"));
  });
}

function buildEventStream(objects: CopObject[]) {
  return objects.slice(0, 5).map((object) => {
    const confidence = Math.round((object.confidence ?? 0) * 100);
    const affiliation = getAffiliationPresentation(object.affiliation);
    return {
      id: `${object.objectId}-${object.status}`,
      title: `${object.status} / ${object.objectType}`,
      detail: `${object.objectId} · ${affiliation.label} · ${confidence} % confidence`,
      tone: affiliation.disposition
    };
  });
}

function sourceHealthLabel(status: SourceHealthItem["health"]): string {
  const labels: Record<SourceHealthItem["health"], string> = {
    DEGRADED: "degraded",
    DISABLED: "disabled",
    ONLINE: "online",
    QUIET: "quiet",
    STALE: "stale",
    UNAVAILABLE: "unavailable",
    WAITING: "waiting"
  };
  return labels[status];
}

function sourceHealthSummary(items: SourceHealthItem[], sourceKey: string): string {
  const item = findSourceHealth(items, sourceKey);
  if (!item) {
    return "waiting";
  }
  if (item.detail) {
    return item.detail;
  }
  return `${sourceHealthLabel(item.health)} · ${item.currentTracks}/${item.totalTracks}`;
}

function sourceHealthTone(items: SourceHealthItem[], sourceKey: string): "ok" | "warn" | "neutral" {
  const item = findSourceHealth(items, sourceKey);
  if (!item) {
    return "neutral";
  }
  return item.health === "ONLINE" || item.health === "QUIET" ? "ok" : item.health === "WAITING" || item.health === "DISABLED" ? "neutral" : "warn";
}

function findSourceHealth(items: SourceHealthItem[], sourceKey: string): SourceHealthItem | undefined {
  const normalizedKey = sourceKey.toLowerCase();
  return items.find((item) => {
    const id = item.sourceSystemId.toLowerCase();
    const type = item.sourceType.toLowerCase();
    return id.includes(normalizedKey) || type.includes(normalizedKey);
  });
}

function formatSourceAge(seconds: number | undefined): string {
  if (seconds === undefined) {
    return "no data";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  return `${Math.round(seconds / 3600)}h`;
}

function createDefaultAoiRule(userLocation: UserLocation | null, mapView: MapViewState | undefined): AoiRule {
  const center = userLocation
    ? { lat: userLocation.lat, lon: userLocation.lon }
    : mapView
      ? { lat: mapView.center[1], lon: mapView.center[0] }
      : defaultAoiCenter;
  return {
    affiliationScope: "all",
    color: "#8cb6d8",
    enabled: false,
    fillOpacity: 0.12,
    id: "primary-aoi",
    lat: center.lat,
    lon: center.lon,
    name: "Moje výstražná zóna",
    radiusKm: 10,
    severity: "warning"
  };
}

function normalizeClientAoiRule(rule: AoiRule): AoiRule {
  const polygon = normalizeClientAoiPolygon(rule.polygon);
  return {
    affiliationScope: "all",
    color: normalizeAoiColor(rule.color),
    enabled: rule.enabled,
    fillOpacity: clamp(rule.fillOpacity ?? 0.12, 0.02, 0.35),
    id: rule.id.trim() || "primary-aoi",
    lat: clamp(rule.lat, -90, 90),
    lon: clamp(rule.lon, -180, 180),
    name: rule.name.trim() || "Moje výstražná zóna",
    ...(polygon ? { polygon } : {}),
    radiusKm: clamp(rule.radiusKm, 1, 80),
    severity: "warning"
  };
}

function createAoiPolygonFromPoints(points: Array<{ lat: number; lon: number }>): AoiRule["polygon"] | undefined {
  const coordinates = points
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
    .map((point): [number, number] => [clamp(point.lon, -180, 180), clamp(point.lat, -90, 90)]);
  if (coordinates.length < 3) {
    return undefined;
  }
  return { type: "Polygon", coordinates: [closeAoiPolygonRing(coordinates)] };
}

function normalizeClientAoiPolygon(polygon: AoiRule["polygon"]): AoiRule["polygon"] | undefined {
  const ring = polygon?.coordinates?.[0];
  if (!ring || ring.length < 3) {
    return undefined;
  }
  const coordinates = ring
    .filter((coordinate) => Array.isArray(coordinate) && coordinate.length >= 2)
    .map(([lon, lat]): [number, number] => [clamp(lon, -180, 180), clamp(lat, -90, 90)])
    .slice(0, 160);
  if (coordinates.length < 3) {
    return undefined;
  }
  return { type: "Polygon", coordinates: [closeAoiPolygonRing(coordinates)] };
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

function calculateAoiPolygonCenter(polygon: NonNullable<AoiRule["polygon"]>): { lat: number; lon: number } {
  const ring = (polygon.coordinates[0] ?? []).slice(0, -1);
  const sums = ring.reduce(
    (accumulator, [lon, lat]) => ({ lat: accumulator.lat + lat, lon: accumulator.lon + lon }),
    { lat: 0, lon: 0 }
  );
  return {
    lat: clamp(sums.lat / Math.max(1, ring.length), -90, 90),
    lon: clamp(sums.lon / Math.max(1, ring.length), -180, 180)
  };
}

function calculateAoiPolygonRadiusKm(center: { lat: number; lon: number }, polygon: NonNullable<AoiRule["polygon"]>): number {
  const radius = (polygon.coordinates[0] ?? [])
    .slice(0, -1)
    .reduce((maximum, [lon, lat]) => Math.max(maximum, distanceBetweenKm(center, { lat, lon })), 1);
  return clamp(Math.ceil(radius), 1, 80);
}

function normalizeAoiColor(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#8cb6d8";
}

function formatAoiZoneGeometry(rule: AoiRule): string {
  if (!rule.polygon) {
    return `${Math.round(rule.radiusKm)} km`;
  }
  return `polygon · ${Math.max(0, (rule.polygon.coordinates[0]?.length ?? 1) - 1)} bodů`;
}

function formatAoiCenter(rule: AoiRule | null): string {
  if (!rule) {
    return `${defaultAoiCenter.lat.toFixed(3)}, ${defaultAoiCenter.lon.toFixed(3)}`;
  }
  return `${rule.lat.toFixed(3)}, ${rule.lon.toFixed(3)}`;
}

function distanceBetweenKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const earthRadiusKm = 6371.0088;
  const deltaLat = degreesToRadians(b.lat - a.lat);
  const deltaLon = degreesToRadians(b.lon - a.lon);
  const startLat = degreesToRadians(a.lat);
  const endLat = degreesToRadians(b.lat);
  const haversine =
    Math.sin(deltaLat / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function defaultSituationLayers(): SituationLayer[] {
  return [
    {
      defaultVisible: true,
      description: "Počasí a prostředí ze SIM situation-data-api.",
      geometryTypes: ["Point", "Polygon"],
      label: "Weather",
      layerId: "weather"
    },
    {
      defaultVisible: false,
      description: "Pozemní kontextové prvky.",
      geometryTypes: ["Point", "LineString", "Polygon"],
      label: "Ground",
      layerId: "ground"
    },
    {
      defaultVisible: false,
      description: "Sjednocené občanské hodnocení mobilní sítě ze SIM.",
      expectedCadenceSeconds: 600,
      geometryTypes: ["Polygon"],
      label: "Mobilní síť",
      layerId: "mobile_network"
    },
    {
      defaultVisible: false,
      description: "Dopravní kontext.",
      geometryTypes: ["Point", "LineString"],
      label: "Traffic",
      layerId: "traffic"
    },
    {
      defaultVisible: false,
      description: "Kvalita ovzduší a environmentální kontext.",
      geometryTypes: ["Point", "Polygon"],
      label: "Air quality",
      layerId: "air_quality"
    }
  ];
}

function defaultSafetyLayers(): SafetyLayer[] {
  return [
    {
      defaultVisible: true,
      description: "Veřejné výstrahy a rizikové události.",
      expectedCadenceSeconds: 300,
      geometryTypes: ["Point", "Polygon"],
      label: "Official warnings",
      layerId: "warnings"
    },
    {
      defaultVisible: false,
      description: "Požáry, hotspoty a ověřené požární incidenty.",
      expectedCadenceSeconds: 600,
      geometryTypes: ["Point", "Polygon"],
      label: "Fire",
      layerId: "fire"
    },
    {
      defaultVisible: true,
      description: "Povodňový a hydrologický kontext.",
      expectedCadenceSeconds: 600,
      geometryTypes: ["Point", "Polygon"],
      label: "Flood and water levels",
      layerId: "flood"
    },
    {
      defaultVisible: false,
      description: "Meteorologické výstrahy podle území a platnosti.",
      expectedCadenceSeconds: 300,
      geometryTypes: ["Polygon"],
      label: "Weather alerts",
      layerId: "weather_alerts"
    }
  ];
}

function defaultTakLayers(): TakLayer[] {
  return [
    {
      defaultVisible: false,
      description: "Partnerské mobilní jednotky z TAK/CoT gateway.",
      expectedCadenceSeconds: 15,
      geometryTypes: ["Point"],
      label: "Mobile units",
      layerId: "mobile"
    },
    {
      defaultVisible: false,
      description: "Partnerské pozemní značky a body z TAK/CoT gateway.",
      expectedCadenceSeconds: 15,
      geometryTypes: ["Point"],
      label: "Ground markers",
      layerId: "ground"
    },
    {
      defaultVisible: false,
      description: "TAK Gateway transportní, vzdušné nebo vozidlové tracky; nejde o veřejnou dopravní vrstvu.",
      expectedCadenceSeconds: 15,
      geometryTypes: ["Point", "LineString"],
      label: "Traffic tracks",
      layerId: "traffic"
    }
  ];
}

function situationLayerHint(layer: SituationLayer): string {
  const cadence = layer.expectedCadenceSeconds ? `${layer.expectedCadenceSeconds}s` : "cadence n/a";
  const geometry = layer.geometryTypes?.join("/") ?? "geo";
  return `${geometry} · ${cadence}`;
}

function formatSituationSourceHint(source: SituationSourceDescriptor): string {
  const layers = source.layers?.filter((layer) => !isSafetyLayerId(layer)).map(situationLayerLabel).join(", ") || "vrstvy n/a";
  const cadence = source.updateCadenceSeconds ? `${source.updateCadenceSeconds}s` : "cadence n/a";
  const state = source.enabled === false ? "vypnuto" : source.mode ?? "live";
  return `${layers} · ${cadence} · ${state}`;
}

function isSafetyOnlySituationSource(source: SituationSourceDescriptor): boolean {
  const layers = source.layers ?? [];
  return layers.length > 0 && layers.every(isSafetyLayerId);
}

function safetyLayerHint(layer: SafetyLayer): string {
  const cadence = layer.expectedCadenceSeconds ? `${layer.expectedCadenceSeconds}s` : "cadence n/a";
  const geometry = layer.geometryTypes?.join("/") ?? "geo";
  return `${geometry} · ${cadence}`;
}

function takLayerHint(layer: TakLayer): string {
  const cadence = layer.expectedCadenceSeconds ? `${layer.expectedCadenceSeconds}s` : "cadence n/a";
  const geometry = layer.geometryTypes?.join("/") ?? "geo";
  return `${geometry} · ${cadence}`;
}

function situationLayerLabel(layerId: SituationLayerId): string {
  const labels: Record<SituationLayerId, string> = {
    air_quality: "Kvalita vzduchu",
    boundary_admin: "Správní hranice",
    community: "Komunitní hlášení",
    fire: "Požáry",
    flight_airports: "Letiště",
    flight_airspaces: "Letecké prostory",
    flood: "Povodně",
    ground: "Terén",
    mobile: "Mobilní síť",
    mobile_coverage: "Technické pokrytí",
    mobile_network: "Mobilní síť",
    mission_arena: "Mission Arena",
    traffic: "Doprava",
    warnings: "Výstrahy",
    weather_alerts: "Meteorologické výstrahy",
    weather: "Počasí"
  };
  return labels[layerId];
}

function situationDisplayLayerLabel(feature: SituationFeature): string {
  if (isTakGatewayFeature(feature)) {
    return `TAK Gateway > ${takLayerLabel(feature.properties.layer as TakLayerId)}`;
  }
  return situationLayerLabel(feature.properties.layer);
}

function safetyLayerLabel(layerId: SafetyLayerId): string {
  const labels: Record<SafetyLayerId, string> = {
    boundary_admin: "Správní hranice",
    fire: "Požáry",
    flood: "Povodně a voda",
    warnings: "Veřejné výstrahy",
    weather_alerts: "Meteorologické výstrahy"
  };
  return labels[layerId];
}

function takLayerLabel(layerId: TakLayerId): string {
  const labels: Record<TakLayerId, string> = {
    ground: "Ground markers",
    mobile: "Mobile units",
    traffic: "Traffic tracks"
  };
  return labels[layerId];
}

function formatSafetySources(sources: SafetySourceDescriptor[], config: SafetyConfigResponse | null): string {
  const enabled = sources.filter((source) => source.enabled).length;
  const total = sources.length || config?.config.enabledSources?.length || 0;
  if (total === 0) {
    return "čekám";
  }
  return `${enabled}/${total}`;
}

function formatTakSources(sources: TakSourceDescriptor[]): string {
  if (sources.length === 0) {
    return "čekám";
  }
  return `${sources.filter((source) => source.enabled !== false).length}/${sources.length}`;
}

function isTakGatewayFeature(feature: SituationFeature): boolean {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return stringProperty(tags.dataSource) === "tak-gateway";
}

function isMissionArenaFeature(feature: SituationFeature): boolean {
  return feature.properties.layer === "mission_arena"
    || feature.properties.layerId === "presentation.mission_arena"
    || feature.properties.providerId === "csm.mission-arena";
}

function missionArenaFeatureRole(feature: SituationFeature): "mission_state" | "task_state" | "team_state" {
  return feature.properties.featureRole === "team_state" || feature.properties.featureRole === "task_state"
    ? feature.properties.featureRole
    : "mission_state";
}

function missionArenaDetailTitle(feature: SituationFeature): string {
  const role = missionArenaFeatureRole(feature);
  if (role === "task_state") {
    const task = missionArenaPrimaryTask(feature);
    return ["Úkol", missionArenaTeamLabel(feature), missionArenaRoleDisplayName(stringProperty(task?.toRole))].filter(Boolean).join(" · ");
  }
  if (role === "team_state") {
    return [missionArenaTeamLabel(feature) ?? "Tým", feature.properties.missionId].filter(Boolean).join(" · ");
  }
  return feature.properties.label;
}

function missionArenaPrimaryTask(feature: SituationFeature): Record<string, unknown> | undefined {
  return Array.isArray(feature.properties.tasking) ? feature.properties.tasking.find(isRecord) : undefined;
}

function missionArenaTeamLabel(feature: SituationFeature): string | undefined {
  return feature.properties.teamLabel ?? missionArenaTeamIdLabel(feature.properties.teamId);
}

function missionArenaTeamIdLabel(teamId: string | undefined): string | undefined {
  const normalized = teamId?.trim().toLowerCase();
  if (normalized === "alfa" || normalized === "blue" || normalized === "modri") {
    return "Modří";
  }
  if (normalized === "bravo" || normalized === "red" || normalized === "cerveni") {
    return "Červení";
  }
  return teamId;
}

function missionArenaRoleDisplayName(role: string | undefined): string | undefined {
  const normalized = role?.trim().toLowerCase();
  if (normalized === "commander") {
    return "velitel";
  }
  if (normalized === "staff") {
    return "štáb";
  }
  if (normalized === "signals") {
    return "spojení";
  }
  if (normalized === "cyber") {
    return "kyber";
  }
  return role;
}

function missionArenaTaskStatusLabel(status: string | undefined): string {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "complete" || normalized === "completed") {
    return "splněno";
  }
  if (normalized === "active" || normalized === "running") {
    return "aktivní";
  }
  if (normalized === "pending" || normalized === "queued") {
    return "čeká";
  }
  return status ?? "úkol";
}

function isCommunicationTowerFeature(feature: SituationFeature): boolean {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
  const providerTags = isRecord(providerProperties.tags) ? providerProperties.tags : {};
  const providerLayerId = feature.properties.providerLayerId ?? stringProperty(providerProperties.providerLayerId);
  return feature.properties.layer === "mobile"
    && feature.properties.category.toLowerCase().replace(/[\s.-]+/g, "_") === "communications_tower"
    && (
      feature.properties.sourceId === "osm_postgis"
      || feature.properties.layerId === "reference.infrastructure.communications"
      || providerLayerId === "mobile.osm_postgis.communications"
      || stringProperty(tags.referenceOnly) === "true"
      || stringProperty(providerTags.referenceOnly) === "true"
    );
}

function formatOsmReference(tags: Record<string, unknown>): string {
  const osmType = stringProperty(tags.osmType);
  const osmId = stringProperty(tags.osmId);
  return [osmType, osmId].filter(Boolean).join(":") || "n/a";
}

function formatTakAffiliation(value: string | undefined): string {
  if (value === "friend") {
    return "vlastní/partner";
  }
  if (value === "hostile") {
    return "rizikový";
  }
  if (value === "neutral") {
    return "neutrální";
  }
  return value ?? "neznámé";
}

function situationStatusFromHealth(health: string | undefined, sourceStatus?: string): SituationLayerStatus {
  const status = (health ?? sourceStatus ?? "").toLowerCase();
  if (status === "online") {
    return "online";
  }
  if (status === "waiting" || status === "disabled") {
    return "disabled";
  }
  if (status === "stale" || status === "degraded" || status === "unavailable") {
    return "degraded";
  }
  return "online";
}

function situationStatusLabel(status: SituationLayerStatus): string {
  const labels: Record<SituationLayerStatus, string> = {
    degraded: "degraded",
    disabled: "off",
    loading: "loading",
    online: "online",
    zoom: "zoom"
  };
  return labels[status];
}

function situationStatusTone(status: SituationLayerStatus): "neutral" | "ok" | "warn" {
  if (status === "online") {
    return "ok";
  }
  if (status === "degraded") {
    return "warn";
  }
  return "neutral";
}

function formatSituationReadiness(status: SituationLayerStatus, collection: SituationFeatureCollectionResponse | null): string {
  if (status === "online" && collection) {
    return `${collection.summary.featureCount} features`;
  }
  if (status === "zoom") {
    return "zoom in";
  }
  return situationStatusLabel(status);
}

function formatSafetyReadiness(status: SituationLayerStatus, collection: SafetyFeatureCollectionResponse | null): string {
  if (status === "online" && collection) {
    return `${collection.summary.featureCount} prvků`;
  }
  if (status === "zoom") {
    return "přiblížit";
  }
  return situationStatusLabel(status);
}

function formatSituationCoordinates(feature: SituationFeature): string {
  if (feature.geometry.type === "Point") {
    return `${feature.geometry.coordinates[1].toFixed(4)}, ${feature.geometry.coordinates[0].toFixed(4)}`;
  }
  if (feature.geometry.type === "LineString") {
    return `${feature.geometry.coordinates.length} bodů`;
  }
  if (feature.geometry.type === "MultiPolygon") {
    return `${feature.geometry.coordinates.length} polygonů`;
  }
  return `${feature.geometry.coordinates.length} polygon ringů`;
}

function formatOptionalPercent(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)} %` : "n/a";
}

function formatSituationRecord(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) {
    return "n/a";
  }
  return Object.entries(value)
    .slice(0, 5)
    .map(([key, entry]) => `${key}: ${formatRecordValue(entry)}`)
    .join(" · ");
}

function formatStringList(value: string[] | undefined): string {
  return value && value.length > 0 ? value.slice(0, 6).join(", ") : "n/a";
}

function formatGeocodes(value: Array<{ scheme: string; value: string }> | undefined): string {
  return value && value.length > 0 ? value.slice(0, 6).map((item) => `${item.scheme}:${item.value}`).join(", ") : "n/a";
}

function situationFeatureStatusModel(feature: SituationFeature): { label: string; tone: "neutral" | "ok" | "warn" | "critical" } {
  if (isMissionArenaFeature(feature)) {
    const role = missionArenaFeatureRole(feature);
    if (role === "task_state") {
      return { label: missionArenaTaskStatusLabel(stringProperty(missionArenaPrimaryTask(feature)?.status)), tone: "neutral" };
    }
    if (role === "team_state") {
      return { label: missionArenaTeamLabel(feature) ?? "TÝM", tone: "neutral" };
    }
    return { label: feature.properties.runtimeMode === "live" ? "LIVE" : "EVENT", tone: "neutral" };
  }
  if (feature.properties.layer === "mobile_coverage" || feature.properties.layer === "mobile_network") {
    const coverage = mobileCoverageQualityModel(feature.properties.quality);
    return feature.properties.stale && coverage.tone === "ok" ? { label: `${coverage.label} · STALE`, tone: "warn" } : coverage;
  }
  if (isCommunicationTowerFeature(feature)) {
    return { label: "REFERENČNÍ", tone: "neutral" };
  }
  if (feature.properties.stale) {
    return { label: "STALE", tone: "warn" };
  }
  const aviationCategory = aviationFlightCategoryModel(feature);
  if (aviationCategory) {
    return aviationCategory;
  }
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const raw = stringProperty(tags.status)
    ?? stringProperty(tags.networkStatus)
    ?? stringProperty(metrics.status)
    ?? stringProperty(metrics.networkStatus)
    ?? feature.properties.severity
    ?? "info";
  const normalized = raw.toLowerCase();
  if (["critical", "down", "offline", "outage", "failed", "error"].includes(normalized)) {
    return { label: "KRITICKÝ", tone: "critical" };
  }
  if (["warning", "degraded", "poor", "weak"].includes(normalized)) {
    return { label: "ZHORŠENÝ", tone: "warn" };
  }
  if (["advisory", "limited", "fair"].includes(normalized)) {
    return { label: "OMEZENÝ", tone: "warn" };
  }
  if (["ok", "online", "good", "fresh", "info"].includes(normalized)) {
    return { label: "OK", tone: "ok" };
  }
  return { label: raw.toUpperCase(), tone: "neutral" };
}

function mobileCoverageQualityModel(quality: string | undefined): { label: string; tone: "neutral" | "ok" | "warn" | "critical" } {
  const normalized = quality?.trim().toLowerCase();
  if (normalized === "good") {
    return { label: "DOBRÉ", tone: "ok" };
  }
  if (normalized === "fair") {
    return { label: "SLUŠNÉ", tone: "warn" };
  }
  if (normalized === "weak") {
    return { label: "SLABÉ", tone: "warn" };
  }
  if (normalized === "none") {
    return { label: "BEZ SIGNÁLU", tone: "critical" };
  }
  return { label: "NEZNÁMÉ", tone: "neutral" };
}

function formatMobileNetworkStatus(status: string | undefined): string {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "weak_signal") {
    return "Slabý signál";
  }
  if (normalized === "degraded_possible") {
    return "Možná degradace";
  }
  if (normalized === "outage_reported") {
    return "Hlášený výpadek";
  }
  if (normalized === "ok") {
    return "OK";
  }
  if (normalized === "unknown") {
    return "Nedostatek dat";
  }
  return status ?? "n/a";
}

function formatCommunicationTowerStatus(status: string | undefined): string {
  const normalized = status?.trim().toLowerCase();
  if (!normalized || normalized === "unknown") {
    return "Stav operátora neznámý";
  }
  return formatMobileNetworkStatus(status);
}

function isAviationWeatherFeature(feature: SituationFeature): boolean {
  return feature.properties.sourceId === "aviation_weather" || feature.properties.category === "aviation_weather_station";
}

function aviationFlightCategoryModel(feature: SituationFeature): { label: string; tone: "neutral" | "ok" | "warn" | "critical" } | null {
  if (!isAviationWeatherFeature(feature)) {
    return null;
  }
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const raw = stringProperty(tags.flightCategory)?.toUpperCase();
  if (raw === "VFR") {
    return { label: "VFR", tone: "ok" };
  }
  if (raw === "MVFR" || raw === "IFR") {
    return { label: raw, tone: "warn" };
  }
  if (raw === "LIFR") {
    return { label: "LIFR", tone: "critical" };
  }
  return raw ? { label: raw, tone: "neutral" } : null;
}

function aviationCategoryTone(category: string | undefined): "neutral" | "ok" | "warn" | "critical" {
  const normalized = category?.toUpperCase();
  if (normalized === "VFR") {
    return "ok";
  }
  if (normalized === "LIFR") {
    return "critical";
  }
  if (normalized === "MVFR" || normalized === "IFR") {
    return "warn";
  }
  return "neutral";
}

function formatWind(directionDeg: number | undefined, speedMps: number | undefined, speedKt: number | undefined): string {
  const speed = speedKt !== undefined ? `${Math.round(speedKt)} kt` : speedMps !== undefined ? `${Math.round(speedMps)} m/s` : undefined;
  if (directionDeg === undefined && !speed) {
    return "n/a";
  }
  return [directionDeg !== undefined ? `${Math.round(directionDeg)}°` : undefined, speed].filter(Boolean).join(" / ");
}

function objectStatusTone(status: string): "neutral" | "ok" | "warn" | "critical" {
  const normalized = status.toUpperCase();
  if (normalized === "ACTIVE") {
    return "ok";
  }
  if (normalized === "CONFLICTED" || normalized === "LOST") {
    return "critical";
  }
  if (normalized === "STALE" || normalized === "INACTIVE") {
    return "warn";
  }
  return "neutral";
}

function mobileMetricTone(value: number | undefined, goodThreshold: number, warnThreshold: number, higherIsBetter: boolean): "neutral" | "ok" | "warn" {
  if (value === undefined) {
    return "neutral";
  }
  if (higherIsBetter) {
    return value >= goodThreshold ? "ok" : value >= warnThreshold ? "warn" : "warn";
  }
  return value <= goodThreshold ? "ok" : value <= warnThreshold ? "warn" : "warn";
}

function trafficDelayTone(value: number | undefined): "neutral" | "ok" | "warn" | "critical" {
  if (value === undefined) {
    return "neutral";
  }
  const delay = Math.abs(value);
  if (delay < 60) {
    return "ok";
  }
  if (delay < 5 * 60) {
    return "warn";
  }
  return "critical";
}

function formatOptionalNumber(value: number | undefined, unit: string): string {
  return value === undefined ? "n/a" : `${Math.round(value * 10) / 10}${unit}`;
}

function formatOptionalInteger(value: number | undefined): string {
  return value === undefined ? "n/a" : String(Math.round(value));
}

function formatSignedOptionalNumber(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function formatMissionArenaScore(value: Record<string, number> | undefined): string {
  if (!value || Object.keys(value).length === 0) {
    return "n/a";
  }
  return Object.entries(value)
    .slice(0, 6)
    .map(([key, entry]) => `${key}: ${Math.round(entry * 10) / 10}`)
    .join(" · ");
}

function recordNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function numberProperty(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatRecordValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} items`;
  }
  if (value && typeof value === "object") {
    return "object";
  }
  return "n/a";
}

function formatPosition(object: CopObject): string {
  if (!object.position) {
    return "n/a";
  }
  const altitude = typeof object.position.altitudeM === "number" ? ` · ${Math.round(object.position.altitudeM)} m` : "";
  return `${object.position.lat.toFixed(3)}, ${object.position.lon.toFixed(3)}${altitude}`;
}

function formatAdapter(provenance: ObjectProvenance | undefined): string {
  if (!provenance?.adapterId) {
    return "n/a";
  }
  return provenance.adapterVersion ? `${provenance.adapterId} ${provenance.adapterVersion}` : provenance.adapterId;
}

function formatShortDateTime(value: string | undefined): string {
  if (!value) {
    return "n/a";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "n/a";
  }
  return timestamp.toLocaleTimeString("cs-CZ");
}

function formatLatency(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(1)} s`;
}

function formatReliability(provenance: ObjectProvenance | undefined): string {
  const reliability = provenance?.sourceReliability ?? "n/a";
  const credibility = provenance?.informationCredibility ?? "n/a";
  return `${reliability}/${credibility}`;
}

function formatMovement(object: CopObject): string {
  const speedMps = object.movement?.speedMps ?? object.speedMps;
  const headingDeg = object.movement?.headingDeg ?? object.headingDeg;
  if (!Number.isFinite(speedMps) && !Number.isFinite(headingDeg)) {
    return "n/a";
  }
  const speed = Number.isFinite(speedMps) ? `${Math.round(Number(speedMps) * 3.6)} km/h` : "speed n/a";
  const heading = Number.isFinite(headingDeg) ? `${Math.round(Number(headingDeg))}°` : "heading n/a";
  return `${speed} · ${heading}`;
}

function formatAge(value: string | undefined): string {
  if (!value) {
    return "live sample";
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "n/a";
  }
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds} s`;
  }
  return `${Math.round(seconds / 60)} min`;
}

function formatUserLocation(location: UserLocation): string {
  const accuracy = Number.isFinite(location.accuracyM) ? ` ± ${Math.round(Number(location.accuracyM))} m` : "";
  return `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}${accuracy}`;
}

function formatProximityAlert(alert: ProximityAlert): string {
  const current = `${alert.currentDistanceKm.toFixed(1)} km`;
  if (typeof alert.predictedDistanceKm === "number") {
    return `${current}, predikce ${alert.predictedDistanceKm.toFixed(1)} km`;
  }
  return `${current} od mé polohy`;
}

function alertSeverityLabel(severity: CopAlert["severity"]): string {
  if (severity === "critical") {
    return "critical";
  }
  if (severity === "warning") {
    return "warning";
  }
  return "info";
}

function alertTypeLabel(type: CopAlert["type"]): string {
  const labels: Record<CopAlert["type"], string> = {
    AOI_ENTRY: "zóna",
    LOW_CONFIDENCE: "confidence",
    SOURCE_DEGRADED: "source",
    TRACK_CONFLICT: "conflict",
    TRACK_LOST: "lost",
    TRACK_STALE: "stale"
  };
  return labels[type];
}

function predictionModeLabel(mode: PredictionMode): string {
  return predictionModeOptions.find(([value]) => value === mode)?.[1] ?? "Adaptivní";
}

function operatorDisplayName(session: AuthSession, config: AuthConfig): string {
  if (session.status === "authenticated") {
    return session.profile?.name ?? "Přihlášen";
  }
  if (session.status === "authenticating") {
    return "Ověřuji";
  }
  if (isOidcEnabled(config)) {
    return "Přihlásit";
  }
  return "Lab režim";
}

function authStatusLabel(session: AuthSession, config: AuthConfig): string {
  if (session.status === "authenticated") {
    return "přihlášen";
  }
  if (session.status === "authenticating") {
    return "ověřuji";
  }
  if (session.status === "error") {
    return "chyba";
  }
  return isOidcEnabled(config) ? "bez přihlášení" : "lab režim";
}

function isUnauthorizedApiError(error: unknown): boolean {
  return error instanceof Error && /^401(?:\s|$)/u.test(error.message);
}

function profileSyncLabel(status: ProfileSyncStatus): string {
  const labels: Record<ProfileSyncStatus, string> = {
    disabled: "vypnuto",
    error: "chyba",
    loading: "načítám",
    saving: "ukládám",
    synced: "synchronizován"
  };
  return labels[status];
}

function profileSyncTone(status: ProfileSyncStatus): "neutral" | "ok" | "warn" {
  if (status === "synced") {
    return "ok";
  }
  if (status === "error") {
    return "warn";
  }
  return "neutral";
}

function formatProfileUpdatedAt(value: string | null): string {
  if (!value) {
    return "zatím ne";
  }
  return formatShortDateTime(value);
}

function userPreferenceScope(session: AuthSession): string {
  if (session.profile?.subjectId) {
    return session.profile.subjectId;
  }
  if (session.profile?.username) {
    return session.profile.username;
  }
  if (session.profile?.email) {
    return session.profile.email;
  }
  return session.status === "lab" ? "lab" : "anonymous";
}

function workspaceMetadata(module: WorkspaceModule): { description: string; label: string } {
  switch (module) {
    case "data":
      return { description: "Track list, filtrování a datové vrstvy.", label: "Data" };
    case "sources":
      return { description: "Source Registry, health, latence a kvalita ingestu.", label: "Zdroje" };
    case "alerts":
      return { description: "Výstrahy, oblast polohy operátora a aktivní přiblížení.", label: "Výstrahy" };
    case "replay":
      return { description: "Historie stop, replay a predikční režimy.", label: "Replay" };
    case "map":
    default:
      return { description: "Primární situační mapa se symboly APP-6.", label: "Mapa" };
  }
}

function workspaceLabel(module: WorkspaceModule): string {
  return workspaceMetadata(module).label;
}

function workspaceIcon(module: WorkspaceModule): React.ReactNode {
  switch (module) {
    case "data":
      return <ListFilter size={16} />;
    case "sources":
      return <RadioTower size={16} />;
    case "alerts":
      return <AlertTriangle size={16} />;
    case "replay":
      return <History size={16} />;
    case "map":
    default:
      return <Layers size={16} />;
  }
}

function catalogGroupIcon(icon: string | undefined, size = 19): React.ReactNode {
  switch (icon) {
    case "alert-triangle":
      return <AlertTriangle size={size} />;
    case "building-2":
      return <Building2 size={size} />;
    case "bus":
      return <Bus size={size} />;
    case "cloud-sun":
      return <CloudSun size={size} />;
    case "database":
      return <Database size={size} />;
    case "map-pin":
      return <MapPin size={size} />;
    case "plane":
      return <Plane size={size} />;
    case "radio-tower":
      return <RadioTower size={size} />;
    case "shield-check":
      return <ShieldCheck size={size} />;
    case "sparkles":
      return <Sparkles size={size} />;
    default:
      return <Layers size={size} />;
  }
}

function catalogLayerHint(layer: MapCatalogLayer, operable: boolean): string {
  if (!operable) {
    return "Připraveno v katalogu, zobrazení se doplní v další integraci";
  }
  const geometry = layer.geometryTypes && layer.geometryTypes.length > 0 ? layer.geometryTypes.join("/") : "data";
  const cadence = typeof layer.refreshSeconds === "number" ? `${layer.refreshSeconds}s` : "dle zdroje";
  return `${geometry} · ${cadence}`;
}

function catalogLayerProviderLabel(layer: MapCatalogLayer): string {
  if (layer.query.providerId === "sim.situation-data") {
    return "Situační data";
  }
  if (layer.query.providerId === "sim.safety-data") {
    return "Bezpečnost";
  }
  if (layer.query.providerId === "sim.flight-data") {
    return "Letecké reference";
  }
  if (layer.query.providerId === "cop.community") {
    return "Komunitní data";
  }
  if (layer.query.providerId === "csm.mission-arena") {
    return "Mission Arena";
  }
  if (layer.query.providerId === "sim.tak-gateway") {
    return "Partnerský feed";
  }
  if (layer.query.providerId === "cop.tracks") {
    return "Live tracky";
  }
  if (layer.query.providerId === "cop.user-profile") {
    return "Uživatelský profil";
  }
  return layer.query.providerId;
}

function readInitialMapToggle(name: "history" | "prediction", fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null ? fallback : value === "1";
}

function readInitialAutoRefresh(fallback = true): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = new URLSearchParams(window.location.search).get("autoRefresh");
  return value === null ? fallback : value !== "0";
}

function readInitialRefreshSeconds(fallback: RefreshSeconds): RefreshSeconds {
  if (typeof window === "undefined") {
    return fallback;
  }
  return parseRefreshSeconds(window.location.search, fallback);
}

function readInitialLayer(value: string | undefined): CopLayer {
  return copLayerIds.includes((value ?? "") as CopLayer)
    ? (value as CopLayer)
    : "air-situation";
}

function normalizeTrackLayerIds(value: string[] | undefined, fallback: CopLayer = "air-situation"): CopLayer[] {
  const layers = (value ?? [fallback]).filter(isCopLayer);
  return Array.from(new Set(layers));
}

function normalizeCatalogLayerIds(value: string[] | undefined): string[] {
  return Array.from(new Set((value ?? []).filter((item) => typeof item === "string" && item.trim().length > 0)));
}

function isCopLayer(value: string): value is CopLayer {
  return copLayerIds.includes(value as CopLayer);
}

function buildMapLayerLabel(trackLayerIds: CopLayer[], situationLayerIds: SituationLayerId[], safetyLayerIds: SafetyLayerId[], takLayerIds: TakLayerId[], flightLayerCount = 0, communityLayerCount = 0, missionArenaLayerCount = 0): string {
  const parts: string[] = [];
  if (trackLayerIds.length > 0) {
    parts.push(`${trackLayerIds.length} air`);
  }
  if (flightLayerCount > 0) {
    parts.push(`${flightLayerCount} flight ref`);
  }
  if (communityLayerCount > 0) {
    parts.push(`${communityLayerCount} reports`);
  }
  if (missionArenaLayerCount > 0) {
    parts.push(`${missionArenaLayerCount} event`);
  }
  if (situationLayerIds.length > 0) {
    parts.push(`${situationLayerIds.length} context`);
  }
  if (safetyLayerIds.length > 0) {
    parts.push(`${safetyLayerIds.length} safety`);
  }
  if (takLayerIds.length > 0) {
    parts.push(`${takLayerIds.length} TAK`);
  }
  return parts.length > 0 ? parts.join(" + ") : "žádná vrstva";
}

function readInitialAffiliationScope(value: string | undefined): AffiliationScope {
  return ["all", "friend", "hostile", "neutral", "unknown"].includes(value ?? "")
    ? (value as AffiliationScope)
    : "all";
}

type CatalogProviderId = "cop.community" | "csm.mission-arena" | "sim.flight-data" | "sim.safety-data" | "sim.situation-data" | "sim.tak-gateway";

function buildCatalogGroupViews(catalog: MapCatalogResponse | null): CatalogGroupView[] {
  if (!catalog) {
    return [];
  }
  const layers = selectableCatalogLayers(catalog);
  return catalog.groups
    .map((group) => ({
      group,
      layers: layers
        .filter((layer) => layer.groupId === group.groupId)
        .sort((a, b) => catalogLayerSortKey(a) - catalogLayerSortKey(b) || a.label.localeCompare(b.label, "cs"))
    }))
    .filter((view) => view.layers.length > 0)
    .sort((a, b) => a.group.order - b.group.order || a.group.label.localeCompare(b.group.label, "cs"));
}

function selectableCatalogLayers(catalog: MapCatalogResponse): MapCatalogLayer[] {
  return catalog.layers.filter((layer) =>
    layer.selectable
    && layer.audience !== "diagnostic"
    && layer.role !== "diagnostic"
    && layer.kind !== "mvt_tiles"
    && layer.kind !== "raster_tiles"
  );
}

function catalogLayerSortKey(layer: MapCatalogLayer): number {
  if (layer.defaultVisible) {
    return 0;
  }
  if (layer.role === "primary") {
    return 10;
  }
  if (layer.role === "overlay") {
    return 20;
  }
  if (layer.role === "reference") {
    return 30;
  }
  return 40;
}

function isImplementedCatalogLayer(layer: MapCatalogLayer): boolean {
  return (layer.query.mode === "bbox"
    && (layer.query.providerId === "cop.community"
      || layer.query.providerId === "csm.mission-arena"
      || layer.query.providerId === "sim.flight-data"
      || layer.query.providerId === "sim.situation-data"
      || layer.query.providerId === "sim.safety-data"
      || layer.query.providerId === "sim.tak-gateway"))
    || layer.layerId === "flight.public.tracks"
    || layer.layerId === "flight.sim.tracks"
    || layer.layerId === "user.zone.alerts";
}

function defaultVisibleCatalogLayerIds(catalog: MapCatalogResponse): string[] {
  return selectableCatalogLayers(catalog)
    .filter((layer) => layer.defaultVisible && isImplementedCatalogLayer(layer) && layer.layerId !== "user.zone.alerts")
    .map((layer) => layer.layerId);
}

function toggleCatalogLayerId(current: string[], layerId: string, enabled: boolean): string[] {
  const selected = new Set(current);
  if (enabled) {
    selected.add(layerId);
  } else {
    selected.delete(layerId);
  }
  return Array.from(selected);
}

function catalogLayerIdsForProviderSelection(catalog: MapCatalogResponse, providerId: CatalogProviderId, selectedLayerIds: string[]): string[] {
  const selected = new Set(selectedLayerIds);
  return catalog.layers
    .filter((layer) => selected.has(layer.layerId) && isImplementedCatalogLayer(layer))
    .filter((layer) => layer.query.mode === "bbox" && layer.query.providerId === providerId)
    .map((layer) => layer.layerId);
}

function hasMobileCatalogSelection(layerIds: string[]): boolean {
  return layerIds.some((layerId) => layerId.includes("mobile"));
}

function countVisibleFlightReferenceLayers(catalog: MapCatalogResponse | null, selectedLayerIds: string[]): number {
  if (!catalog) {
    return 0;
  }
  const selected = new Set(selectedLayerIds);
  return catalog.layers.filter((layer) =>
    selected.has(layer.layerId)
    && isImplementedCatalogLayer(layer)
    && layer.query.mode === "bbox"
    && layer.query.providerId === "sim.flight-data"
  ).length;
}

function countVisibleCommunityLayers(catalog: MapCatalogResponse | null, selectedLayerIds: string[]): number {
  if (!catalog) {
    return 0;
  }
  const selected = new Set(selectedLayerIds);
  return catalog.layers.filter((layer) =>
    selected.has(layer.layerId)
    && isImplementedCatalogLayer(layer)
    && layer.query.mode === "bbox"
    && layer.query.providerId === "cop.community"
  ).length;
}

function countVisibleMissionArenaLayers(catalog: MapCatalogResponse | null, selectedLayerIds: string[]): number {
  if (!catalog) {
    return 0;
  }
  const selected = new Set(selectedLayerIds);
  return catalog.layers.filter((layer) =>
    selected.has(layer.layerId)
    && isImplementedCatalogLayer(layer)
    && layer.query.mode === "bbox"
    && layer.query.providerId === "csm.mission-arena"
  ).length;
}

function catalogLayerIdsFromLegacySelection(
  catalog: MapCatalogResponse,
  selection: {
    safetyLayerIds: SafetyLayerId[];
    situationLayerIds: SituationLayerId[];
    situationSourceIds: string[];
    takLayerIds: TakLayerId[];
    trackLayerIds: CopLayer[];
  }
): string[] {
  return selectableCatalogLayers(catalog)
    .filter(isImplementedCatalogLayer)
    .filter((layer) => catalogLayerMatchesLegacySelection(layer, selection))
    .map((layer) => layer.layerId);
}

function catalogLayerMatchesLegacySelection(
  layer: MapCatalogLayer,
  selection: {
    safetyLayerIds: SafetyLayerId[];
    situationLayerIds: SituationLayerId[];
    situationSourceIds: string[];
    takLayerIds: TakLayerId[];
    trackLayerIds: CopLayer[];
  }
): boolean {
  const providerLayerIds = layer.query.providerLayerIds ?? [];
  const providerSourceIds = layer.query.providerSourceIds ?? [];
  if (layer.layerId === "flight.public.tracks") {
    return selection.trackLayerIds.includes("air-situation") || selection.trackLayerIds.includes("public-flights");
  }
  if (layer.layerId === "flight.sim.tracks") {
    return selection.trackLayerIds.includes("air-situation") || selection.trackLayerIds.includes("sim-air");
  }
  if (layer.layerId === "user.zone.alerts") {
    return false;
  }
  if (layer.query.providerId === "sim.situation-data") {
    const layerMatch = providerLayerIds.some((layerId) => isSituationLayerId(layerId) && selection.situationLayerIds.includes(layerId));
    const sourceMatch = selection.situationSourceIds.length === 0
      || providerSourceIds.length === 0
      || providerSourceIds.some((sourceId) => selection.situationSourceIds.includes(sourceId));
    return layerMatch && sourceMatch;
  }
  if (layer.query.providerId === "sim.safety-data") {
    return providerLayerIds.some((layerId) => isSafetyLayerId(layerId) && selection.safetyLayerIds.includes(layerId));
  }
  if (layer.query.providerId === "sim.tak-gateway") {
    return providerLayerIds.some((layerId) => isTakLayerId(layerId) && selection.takLayerIds.includes(layerId));
  }
  return false;
}

function legacySelectionFromCatalogLayerIds(
  catalog: MapCatalogResponse,
  catalogLayerIds: string[]
): {
  safetyLayerIds: SafetyLayerId[];
  situationLayerIds: SituationLayerId[];
  situationSourceIds: string[];
  takLayerIds: TakLayerId[];
  trackLayerIds: CopLayer[];
} {
  const selected = new Set(catalogLayerIds);
  const situationLayerIds = new Set<SituationLayerId>();
  const situationSourceIds = new Set<string>();
  const safetyLayerIds = new Set<SafetyLayerId>();
  const takLayerIds = new Set<TakLayerId>();
  const trackLayerIds = new Set<CopLayer>();

  for (const layer of catalog.layers) {
    if (!selected.has(layer.layerId) || !isImplementedCatalogLayer(layer)) {
      continue;
    }
    if (layer.layerId === "flight.public.tracks") {
      trackLayerIds.add("public-flights");
      continue;
    }
    if (layer.layerId === "flight.sim.tracks") {
      trackLayerIds.add("sim-air");
      continue;
    }
    if (layer.query.providerId === "sim.situation-data") {
      for (const providerLayerId of layer.query.providerLayerIds ?? []) {
        if (isSituationLayerId(providerLayerId)) {
          situationLayerIds.add(providerLayerId);
        }
      }
      for (const sourceId of layer.query.providerSourceIds ?? []) {
        situationSourceIds.add(sourceId);
      }
    }
    if (layer.query.providerId === "sim.safety-data") {
      for (const providerLayerId of layer.query.providerLayerIds ?? []) {
        if (isSafetyLayerId(providerLayerId)) {
          safetyLayerIds.add(providerLayerId);
        }
      }
    }
    if (layer.query.providerId === "sim.tak-gateway") {
      for (const providerLayerId of layer.query.providerLayerIds ?? []) {
        if (isTakLayerId(providerLayerId)) {
          takLayerIds.add(providerLayerId);
        }
      }
    }
  }

  return {
    safetyLayerIds: normalizeSafetyLayerIds(Array.from(safetyLayerIds)),
    situationLayerIds: normalizeSituationLayerIds(Array.from(situationLayerIds)),
    situationSourceIds: sanitizeCitizenSituationSourceIds(Array.from(situationSourceIds)),
    takLayerIds: normalizeTakLayerIds(Array.from(takLayerIds)),
    trackLayerIds: normalizeTrackLayerIds(Array.from(trackLayerIds), "public-flights")
  };
}

function providerStatusFromCatalog(catalog: MapCatalogResponse, providerId: CatalogProviderId): SituationLayerStatus {
  const status = catalog.providers.find((provider) => provider.providerId === providerId)?.status;
  if (status === "online") {
    return "online";
  }
  if (status === "disabled") {
    return "disabled";
  }
  return "degraded";
}

function mapCatalogToSituationLayers(catalog: MapCatalogResponse): SituationLayer[] {
  const layers = new Map<SituationLayerId, SituationLayer>();
  for (const catalogLayer of catalog.layers) {
    if (catalogLayer.query.providerId !== "sim.situation-data" || !catalogLayer.selectable) {
      continue;
    }
    for (const providerLayerId of catalogLayer.query.providerLayerIds ?? []) {
      if (!isSituationLayerId(providerLayerId) || providerLayerId === "mobile" || providerLayerId === "mobile_coverage") {
        continue;
      }
      const current = layers.get(providerLayerId);
      layers.set(providerLayerId, mergeSituationLayer(current, providerLayerId, catalogLayer));
    }
  }
  return layers.size > 0 ? Array.from(layers.values()) : defaultSituationLayers();
}

function mergeSituationLayer(current: SituationLayer | undefined, layerId: SituationLayerId, catalogLayer: MapCatalogLayer): SituationLayer {
  return {
    defaultVisible: (current?.defaultVisible ?? false) || catalogLayer.defaultVisible,
    description: current?.description ?? catalogLayer.description,
    expectedCadenceSeconds: minCadenceSeconds(current?.expectedCadenceSeconds, catalogLayer.refreshSeconds),
    geometryTypes: mergeGeometryTypes(current?.geometryTypes, catalogLayer.geometryTypes),
    label: current?.label ?? catalogLayer.label,
    layerId
  };
}

function mapCatalogToSafetyLayers(catalog: MapCatalogResponse): SafetyLayer[] {
  const layers = new Map<SafetyLayerId, SafetyLayer>();
  for (const catalogLayer of catalog.layers) {
    if (catalogLayer.query.providerId !== "sim.safety-data" || !catalogLayer.selectable) {
      continue;
    }
    for (const providerLayerId of catalogLayer.query.providerLayerIds ?? []) {
      if (!isSafetyLayerId(providerLayerId)) {
        continue;
      }
      const current = layers.get(providerLayerId);
      layers.set(providerLayerId, {
        defaultVisible: (current?.defaultVisible ?? false) || catalogLayer.defaultVisible,
        description: current?.description ?? catalogLayer.description,
        expectedCadenceSeconds: minCadenceSeconds(current?.expectedCadenceSeconds, catalogLayer.refreshSeconds),
        geometryTypes: mergeGeometryTypes(current?.geometryTypes, catalogLayer.geometryTypes),
        label: current?.label ?? catalogLayer.label,
        layerId: providerLayerId
      });
    }
  }
  return layers.size > 0 ? Array.from(layers.values()) : defaultSafetyLayers();
}

function mapCatalogToTakLayers(catalog: MapCatalogResponse): TakLayer[] {
  const layers = new Map<TakLayerId, TakLayer>();
  for (const catalogLayer of catalog.layers) {
    if (catalogLayer.query.providerId !== "sim.tak-gateway" || !catalogLayer.selectable) {
      continue;
    }
    for (const providerLayerId of catalogLayer.query.providerLayerIds ?? []) {
      if (!isTakLayerId(providerLayerId)) {
        continue;
      }
      const current = layers.get(providerLayerId);
      layers.set(providerLayerId, {
        defaultVisible: (current?.defaultVisible ?? false) || catalogLayer.defaultVisible,
        description: current?.description ?? catalogLayer.description,
        expectedCadenceSeconds: minCadenceSeconds(current?.expectedCadenceSeconds, catalogLayer.refreshSeconds),
        geometryTypes: mergeGeometryTypes(current?.geometryTypes, catalogLayer.geometryTypes),
        label: current?.label ?? catalogLayer.label,
        layerId: providerLayerId
      });
    }
  }
  return layers.size > 0 ? Array.from(layers.values()) : defaultTakLayers();
}

function mapCatalogToSituationSources(catalog: MapCatalogResponse): SituationSourceDescriptor[] {
  return catalog.sources
    .filter((source) => source.providerId === "sim.situation-data" && source.selectableInMap)
    .map((source) => ({
      enabled: source.enabled,
      label: source.label,
      layers: providerLayerIdsForCatalogSource(catalog, source).filter(isSituationLayerId),
      sourceId: source.sourceId,
      updateCadenceSeconds: source.updateCadenceSeconds
    }))
    .filter((source) => source.layers && source.layers.length > 0);
}

function mapCatalogToSafetySources(catalog: MapCatalogResponse): SafetySourceDescriptor[] {
  return catalog.sources
    .flatMap((source): SafetySourceDescriptor[] => {
      if (source.providerId !== "sim.safety-data" || !source.selectableInMap || !isSafetySourceId(source.sourceId)) {
        return [];
      }
      return [{
        enabled: source.enabled,
        label: source.label,
        layers: providerLayerIdsForCatalogSource(catalog, source).filter(isSafetyLayerId),
        sourceId: source.sourceId,
        updateCadenceSeconds: source.updateCadenceSeconds
      }];
    });
}

function mapCatalogToTakSources(catalog: MapCatalogResponse): TakSourceDescriptor[] {
  return catalog.sources
    .filter((source) => source.providerId === "sim.tak-gateway" && source.selectableInMap)
    .map((source) => ({
      enabled: source.enabled,
      label: source.label,
      layers: providerLayerIdsForCatalogSource(catalog, source).filter(isTakLayerId),
      sourceId: source.sourceId,
      updateCadenceSeconds: source.updateCadenceSeconds
    }));
}

function providerLayerIdsForCatalogSource(catalog: MapCatalogResponse, source: MapCatalogSource): string[] {
  const catalogLayerIds = new Set([...(source.feedsCatalogLayerIds ?? []), ...(source.usedByCatalogLayerIds ?? [])]);
  return Array.from(new Set(catalog.layers
    .filter((layer) => catalogLayerIds.has(layer.layerId))
    .flatMap((layer) => layer.query.providerLayerIds ?? [])));
}

function mapCatalogLayerIdsForProviderSelection(
  catalog: MapCatalogResponse,
  providerId: CatalogProviderId,
  providerLayerIds: string[],
  selectedSourceIds: string[] = []
): string[] {
  const selectedLayers = new Set(providerLayerIds);
  const selectedSources = new Set(selectedSourceIds);
  return catalog.layers
    .filter((layer) => layer.selectable && layer.query.mode === "bbox" && layer.query.providerId === providerId)
    .filter((layer) => (layer.query.providerLayerIds ?? []).some((layerId) => selectedLayers.has(layerId)))
    .filter((layer) => selectedSources.size === 0 || (layer.query.providerSourceIds ?? []).some((sourceId) => selectedSources.has(sourceId)))
    .map((layer) => layer.layerId);
}

function buildCatalogFeatureFilters(layerIds: string[], technology: CoverageTechnology | undefined): Record<string, Record<string, unknown>> {
  if (!technology) {
    return {};
  }
  return Object.fromEntries(
    layerIds
      .filter((layerId) => layerId.includes("mobile"))
      .map((layerId) => [layerId, { technology: [technology] }])
  );
}

function mergeGeometryTypes(current: string[] | undefined, next: string[] | undefined): string[] | undefined {
  const merged = Array.from(new Set([...(current ?? []), ...(next ?? [])]));
  return merged.length > 0 ? merged : undefined;
}

function minCadenceSeconds(current: number | undefined, next: number | undefined): number | undefined {
  const values = [current, next].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? Math.min(...values) : undefined;
}

function isSafetySourceId(value: string): value is SafetyDataSourceId {
  return value === "admin_boundaries"
    || value === "chmi_alerts"
    || value === "chmi_hydro"
    || value === "fire_hotspots"
    || value === "fire_incidents"
    || value === "mock"
    || value === "nasa_firms"
    || value === "weather_alerts";
}

function readInitialDomainScope(value: string | undefined): DomainScope {
  return ["all", "AIR", "LAND", "SEA", "RESCUE", "OTHER"].includes(value ?? "") ? (value as DomainScope) : "all";
}

function readInitialPredictionMode(value: string | undefined): PredictionMode {
  return predictionModeOptions.some(([option]) => option === value) ? (value as PredictionMode) : "adaptive";
}

function normalizePublicFlightSymbolMode(value: string | undefined): PublicFlightSymbolMode {
  return value === "standard" ? "standard" : "civil";
}

function normalizeMapBasemapMode(value: string | undefined): MapBasemapMode {
  return value === "civil" || value === "risk" || value === "dark" ? value : "standard";
}

function normalizeTrackHistoryDisplayMode(value: string | undefined): TrackHistoryDisplayMode {
  return value === "selected" ? "selected" : "all";
}

function readInitialHistoryLimit(value: number | undefined): number {
  const normalizedValue = Number(value);
  return historyLimitOptions.includes(normalizedValue as (typeof historyLimitOptions)[number]) ? normalizedValue : 120;
}

function readInitialHistoryWindowSeconds(value: number | undefined): number {
  if (typeof window !== "undefined") {
    const queryValue = Number(new URLSearchParams(window.location.search).get("historySeconds"));
    if (historyWindowOptions.includes(queryValue as (typeof historyWindowOptions)[number])) {
      return queryValue;
    }
  }

  return normalizeHistoryWindowSeconds(value);
}

function normalizeHistoryWindowSeconds(value: number | undefined): number {
  const normalizedValue = Number(value);
  return historyWindowOptions.includes(normalizedValue as (typeof historyWindowOptions)[number]) ? normalizedValue : 180;
}

function normalizeSituationLayerIds(value: string[] | undefined): SituationLayerId[] {
  const layers = normalizeCitizenSituationLayerIds((value ?? defaultSituationLayerIds).filter(isSituationLayerId));
  const unique = Array.from(new Set(layers));
  return value === undefined && unique.length === 0 ? [...defaultSituationLayerIds] : unique;
}

function normalizeSourceIds(value: string[] | undefined): string[] {
  return sanitizeCitizenSituationSourceIds(value ?? []);
}

function isSituationLayerId(value: string): value is SituationLayerId {
  return value === "weather"
    || value === "boundary_admin"
    || value === "community"
    || value === "fire"
    || value === "flight_airports"
    || value === "flight_airspaces"
    || value === "ground"
    || value === "mobile"
    || value === "mobile_coverage"
    || value === "mobile_network"
    || value === "mission_arena"
    || value === "traffic"
    || value === "warnings"
    || value === "weather_alerts"
    || value === "flood"
    || value === "air_quality";
}

function normalizeCoverageTechnology(value: string | undefined): CoverageTechnology {
  const normalized = value?.trim().toUpperCase();
  return normalized === "2G" || normalized === "5G" ? normalized : "4G";
}

function normalizeSafetyLayerIds(value: string[] | undefined): SafetyLayerId[] {
  const layers = (value ?? defaultSafetyLayerIds).filter(isSafetyLayerId);
  const unique = Array.from(new Set(layers));
  return value === undefined && unique.length === 0 ? [...defaultSafetyLayerIds] : unique;
}

function isSafetyLayerId(value: string): value is SafetyLayerId {
  return value === "warnings" || value === "weather_alerts" || value === "flood" || value === "fire" || value === "boundary_admin";
}

function normalizeTakLayerIds(value: string[] | undefined): TakLayerId[] {
  const layers = (value ?? defaultTakLayerIds).filter(isTakLayerId);
  return Array.from(new Set(layers));
}

function isTakLayerId(value: string): value is TakLayerId {
  return value === "mobile" || value === "ground" || value === "traffic";
}

function communityGroupMembersToMessagingMembers(group: CommunityGroup): Array<{ displayName?: string; role?: string; userId: string }> {
  return group.members
    .filter((member) => member.status === "active")
    .map((member) => ({
      ...(member.displayName ? { displayName: member.displayName } : {}),
      role: member.role,
      userId: member.subjectId
    }));
}

function findMessagingConversationForCommunityGroup(group: CommunityGroup, conversations: MessagingConversationSummary[]): MessagingConversationSummary | undefined {
  return conversations.find((conversation) => conversation.metadata?.externalId === group.groupId)
    ?? conversations.find((conversation) => conversation.title === group.name);
}

function shouldSkipSituationFeatureLoad(bounds: MapBounds, zoom: number | undefined): boolean {
  const width = Math.abs(bounds.east - bounds.west);
  const height = Math.abs(bounds.north - bounds.south);
  return (zoom ?? 0) < 6 || width > 6 || height > 4;
}

function readBooleanEnv(value: string | undefined, fallback = true): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

registerCopServiceWorker();

const rootElement = document.getElementById("root");
if (rootElement) {
  const isXrRoute = window.location.pathname === "/xr" || window.location.pathname.startsWith("/xr/");
  createRoot(rootElement).render(
    <React.StrictMode>
      {isXrRoute ? (
        <React.Suspense fallback={<main className="xr-shell"><div className="xr-loading">Načítám prostorový režim...</div></main>}>
          <XrWorkspace />
        </React.Suspense>
      ) : (
        <App />
      )}
    </React.StrictMode>
  );
}
