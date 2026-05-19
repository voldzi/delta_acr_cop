import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Bot,
  Clock3,
  Database,
  Gauge,
  History,
  Layers,
  ListFilter,
  LogIn,
  LogOut,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  RadioTower,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
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
  isOidcEnabled,
  readAuthConfig,
  type AuthConfig,
  type AuthSession
} from "./auth";
import {
  acknowledgeCopAlert,
  connectCopStream,
  fetchCopDashboardData,
  fetchCopAlerts,
  fetchUserProfile,
  filterObjectsByLayer,
  filterVisibleObjects,
  getDataQualityCount,
  getUavCount,
  saveUserProfile,
  type AlertPreferences,
  type CopStreamMessage,
  type CopStreamStatus,
  type CopAlert,
  type CopLayer,
  type CopObject,
  type CopStreamHealth,
  type HealthStatus,
  type ObjectProvenance,
  type SourceHealthItem,
  type SourceSystem
} from "./cop-data";
import { CopMap } from "./CopMap";
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
import {
  clamp,
  normalizeMapView,
  normalizeUserPreferences,
  readUserPreferences,
  writeUserPreferences,
  type MapViewState,
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
import "./styles.css";

const apiBase = import.meta.env.VITE_COP_API_BASE_URL ?? "";
const labToken =
  import.meta.env.VITE_COP_PUBLIC_LAB_VALUE ??
  import.meta.env.VITE_COP_AUTH_VALUE ??
  import.meta.env.VITE_COP_LAB_TOKEN ??
  "dev-lab-token";
const defaultRefreshSeconds = refreshMillisecondsToSeconds(import.meta.env.VITE_COP_REFRESH_MS ?? "5000");

type AffiliationScope = "all" | "friend" | "hostile" | "neutral" | "unknown";
type DomainScope = "all" | "AIR" | "LAND" | "SEA" | "RESCUE" | "OTHER";
type PreferenceSettings = ViewProfileSettings | UserPreferences;
type SettingsTab = "map" | "data" | "awareness" | "account";
type ProfileSyncStatus = "disabled" | "error" | "loading" | "saving" | "synced";

const historyLimitOptions = [36, 72, 120, 240, 600] as const;
const historyWindowOptions = [30, 60, 120, 180, 300, 600] as const;
const predictionModeOptions: Array<[PredictionMode, string]> = [
  ["adaptive", "Adaptivní"],
  ["telemetry", "Telemetrie"],
  ["history", "Trend"],
  ["maneuver", "Manévr"]
];

interface DashboardMetrics {
  activeSources: number;
  avgConfidence: number;
  foreignCount: number;
  friendlyCount: number;
  lowConfidenceCount: number;
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
  const [selectedObjectId, setSelectedObjectId] = React.useState<string | null>(null);
  const [includeSynthetic, setIncludeSynthetic] = React.useState(initialPreferences.includeSynthetic ?? true);
  const [minConfidence, setMinConfidence] = React.useState(() => clamp(initialPreferences.minConfidence ?? 0.2, 0, 1));
  const [affiliationScope, setAffiliationScope] = React.useState<AffiliationScope>(() =>
    readInitialAffiliationScope(initialPreferences.affiliationScope)
  );
  const [domainScope, setDomainScope] = React.useState<DomainScope>(() => readInitialDomainScope(initialPreferences.domainScope));
  const [searchQuery, setSearchQuery] = React.useState("");
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
  const [predictionMinutes, setPredictionMinutes] = React.useState(() => clamp(initialPreferences.predictionMinutes ?? 10, 2, 20));
  const [predictionMode, setPredictionMode] = React.useState<PredictionMode>(() => readInitialPredictionMode(initialPreferences.predictionMode));
  const [trackHistoryLimit, setTrackHistoryLimit] = React.useState(() => readInitialHistoryLimit(initialPreferences.trackHistoryLimit));
  const [trackHistoryWindowSeconds, setTrackHistoryWindowSeconds] = React.useState(() =>
    readInitialHistoryWindowSeconds(initialPreferences.trackHistoryWindowSeconds)
  );
  const [trackHistory, setTrackHistory] = React.useState<TrackHistory>({});
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>("map");
  const [autoFit, setAutoFit] = React.useState(initialPreferences.autoFit ?? true);
  const [mapView, setMapView] = React.useState<MapViewState | undefined>(() => normalizeMapView(initialPreferences.mapView));
  const [focusViewRequest, setFocusViewRequest] = React.useState(0);
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
  const [aiResult, setAiResult] = React.useState("Mock AI provider připraven pro dotazy nad COP daty.");
  const loadInFlightRef = React.useRef(false);
  const profileHydratedRef = React.useRef(false);
  const profileLoadKeyRef = React.useRef<string | null>(null);
  const profileSaveTimerRef = React.useRef<number | undefined>(undefined);
  const skipNextPreferenceWriteRef = React.useRef(false);
  const notifiedProximityAlertsRef = React.useRef<Set<string>>(new Set());
  const authToken = getAuthorizationToken(authSession, labToken);
  const dataAccessReady = authConfig.mode !== "oidc" || Boolean(authSession.accessToken);

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
      setLoadError("Pro načtení COP dat je potřeba přihlášení.");
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
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Nepodařilo se načíst COP data.");
    } finally {
      loadInFlightRef.current = false;
      setIsLoading(false);
    }
  }, [authToken, dataAccessReady, trackHistoryLimit, trackHistoryWindowSeconds]);

  const loadAlerts = React.useCallback(async () => {
    if (!dataAccessReady) {
      return;
    }
    try {
      setServerAlerts(await fetchCopAlerts(apiBase, authToken));
    } catch {
      // Main data loading already reports API errors; alert refresh should not obscure the current COP view.
    }
  }, [authToken, dataAccessReady]);

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
    const scheduleReconnect = () => {
      reconnectTimer = window.setTimeout(() => {
        if (active) {
          setStreamReconnectAttempt((current) => current + 1);
        }
      }, 5000);
    };
    setStreamStatus("connecting");
    const connection = connectCopStream(apiBase, authToken, {
      onError: (error) => {
        if (active) {
          setStreamTelemetry((current) => updateStreamTelemetryForError(current, error));
          setStreamStatus(browserOnline ? "degraded" : "offline");
          scheduleReconnect();
        }
      },
      onMessage: (message) => {
        if (!active) {
          return;
        }
        setStreamTelemetry((current) => updateStreamTelemetryForMessage(current, message));
        if (message.type === "reconnect_required") {
          setStreamStatus("degraded");
          setStreamReconnectAttempt((current) => current + 1);
          return;
        }
        applyCopStreamMessage(message, {
          setLastLoadedAt,
          setLastStreamAt,
          setObjects,
          setStreamStatus,
          setTrackHistory,
          trackHistoryLimit,
          trackHistoryWindowSeconds
        });
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
        if (reconnectTimer !== undefined) {
          window.clearTimeout(reconnectTimer);
        }
      };
    }

    return () => {
      active = false;
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
    if (!dataAccessReady) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadAlerts();
    }, Math.max(refreshSeconds, 5) * 1000);
    return () => window.clearInterval(timer);
  }, [dataAccessReady, loadAlerts, refreshSeconds]);

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
  const scopedObjects = React.useMemo(
    () => applyOperationalFilters(baseFilteredObjects, affiliationScope, domainScope, searchQuery),
    [affiliationScope, baseFilteredObjects, domainScope, searchQuery]
  );
  const visibleObjects = React.useMemo(
    () => filterObjectsByLayer(scopedObjects, selectedLayer),
    [scopedObjects, selectedLayer]
  );
  const mapEmptyMessage = React.useMemo(
    () => buildMapEmptyMessage({ loadError, objects: objectsForDisplay, replayActive, scopedObjects, sources, visibleObjects }),
    [loadError, objectsForDisplay, replayActive, scopedObjects, sources, visibleObjects]
  );
  const selectedObject = visibleObjects.find((object) => object.objectId === selectedObjectId) ?? visibleObjects[0];
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

  const applyPreferenceSettings = React.useCallback((settings: PreferenceSettings, options: { focusMap?: boolean } = {}) => {
    if (settings.activeWorkspace !== undefined) {
      setActiveWorkspace(normalizeWorkspaceModule(settings.activeWorkspace));
    }
    if (settings.selectedLayer !== undefined) {
      setSelectedLayer(readInitialLayer(settings.selectedLayer));
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
    if (settings.showPrediction !== undefined) {
      setShowPrediction(settings.showPrediction);
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
    domainScope,
    includeSynthetic,
    mapView,
    minConfidence,
    predictionMinutes,
    predictionMode,
    proximityAlertEnabled,
    refreshSeconds,
    selectedLayer,
    showHistory,
    showPrediction,
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
    mapView,
    minConfidence,
    predictionMinutes,
    predictionMode,
    proximityAlertEnabled,
    refreshSeconds,
    selectedLayer,
    showHistory,
    showPrediction,
    trackHistoryLimit,
    trackHistoryWindowSeconds
  ]);

  React.useEffect(() => {
    profileHydratedRef.current = false;
    profileLoadKeyRef.current = null;
    skipNextPreferenceWriteRef.current = true;
    applyPreferenceSettings(readUserPreferences(userStorageScope), { focusMap: true });
    setViewProfiles(readViewProfiles(userStorageScope));
    setLastProfileName(null);
    setServerProfileUpdatedAt(null);
    setProfileSyncError(null);
    setProfileSyncStatus(dataAccessReady ? "loading" : "disabled");
  }, [applyPreferenceSettings, dataAccessReady, userStorageScope]);

  React.useEffect(() => {
    if (!dataAccessReady) {
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
    dataAccessReady,
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
    if (!dataAccessReady || !profileHydratedRef.current) {
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
    dataAccessReady,
    userStorageScope
  ]);

  React.useEffect(() => {
    if (selectedObjectId && !visibleObjects.some((object) => object.objectId === selectedObjectId)) {
      setSelectedObjectId(null);
    }
  }, [selectedObjectId, visibleObjects]);

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
      new window.Notification("COP výstraha přiblížení", {
        body: formatProximityAlert(nextAlert)
      });
    }
  }, [proximityAlertEnabled, proximityAlerts]);

  async function askAi() {
    const response = await fetch(`${apiBase}/api/v1/ai/cop-assistant/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        purpose: "DATA_QUALITY_CHECK",
        prompt: "Shrň kvalitu aktuálního COP pohledu a odliš simulovaná data.",
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

  async function acknowledgeServerAlert(alertId: string) {
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

  function logoutOperator() {
    endSession(authConfig, authSession);
    setAuthSession(createInitialAuthSession(authConfig));
  }

  function applyViewProfile(profile: ViewProfile) {
    applyPreferenceSettings(profile.settings, { focusMap: true });
    setLastProfileName(profile.name);
  }

  function saveCurrentViewProfile() {
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
        mapView,
        minConfidence,
        predictionMinutes,
        predictionMode,
        proximityAlertEnabled,
        refreshSeconds,
        selectedLayer,
        showHistory,
        showPrediction,
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
  const showLayerControls = activeWorkspace === "map" || activeWorkspace === "data";
  const showSourceControls = activeWorkspace === "map" || activeWorkspace === "sources";
  const showAlertControls = activeWorkspace === "alerts";
  const showReplayControls = activeWorkspace === "replay";

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <img src="/icons/cop-icon.svg" alt="" />
          </div>
          <div>
            <h1>ACR COP Data Fabric</h1>
            <p>SITDATA-COP / lab common operating picture</p>
          </div>
        </div>
        <div className="mission-strip" aria-label="COP operating context">
          <span>LAB</span>
          <strong>SIM LIVE</strong>
          <small>OpenStreetMap + APP-6</small>
        </div>
        <div className="status-strip">
          <StatusItem icon={<Wifi size={16} />} label="API" value={health?.status === "ok" ? "OK" : "loading"} tone={health?.status === "ok" ? "ok" : "warn"} />
          <StatusItem icon={<Activity size={16} />} label="Stream" value={streamStatusLabel(streamStatus)} tone={streamStatusTone(streamStatus)} />
          <StatusItem icon={<RadioTower size={16} />} label="Sources" value={String(sources.length)} tone={metrics.activeSources > 0 ? "ok" : "warn"} />
          <StatusItem icon={<Database size={16} />} label="Objects" value={String(visibleObjects.length)} tone="neutral" />
        </div>
        <button
          aria-label="Operátor - otevřít nastavení"
          className="operator-button"
          onClick={() => openSettings("account")}
          title="Operátor - otevřít nastavení"
          type="button"
        >
          <UserCircle size={19} />
          <span>
            Operátor
            <strong>{operatorDisplayName(authSession, authConfig)}</strong>
          </span>
          <Settings size={16} />
        </button>
      </header>

      <WorkspaceNavigator activeWorkspace={activeWorkspace} onChange={setActiveWorkspace} onOpenSettings={() => openSettings("map")} />

      <section className="workspace">
        <aside className="panel left-panel">
          <div className="refresh-row">
            <div>
              <span>Poslední načtení</span>
              <strong>{lastLoadedAt ?? "čekám na data"}</strong>
            </div>
            <button className="icon-button" onClick={() => void load()} disabled={isLoading} title="Obnovit COP data">
              <RefreshCw size={16} className={isLoading ? "spin" : ""} />
            </button>
          </div>
          {loadError ? <div className="error-banner">API chyba: {loadError}. Poslední platná data zůstávají zobrazena.</div> : null}

          <ViewProfilesPanel
            activeProfileName={lastProfileName}
            profiles={viewProfiles}
            userScope={userStorageScope}
            onApply={applyViewProfile}
            onSave={saveCurrentViewProfile}
          />

          <div className="mission-metrics">
            <MetricTile label="Friendly" value={metrics.friendlyCount} tone="friend" />
            <MetricTile label="Foreign" value={metrics.foreignCount} tone="hostile" />
            <MetricTile label="Confidence" value={`${metrics.avgConfidence}%`} tone={metrics.avgConfidence >= 75 ? "ok" : "warn"} />
            <MetricTile label="Alerts" value={alertSummary.total} tone={alertSummary.total > 0 ? "warn" : "ok"} />
          </div>

          {showLayerControls ? (
            <>
              <PanelTitle icon={<Layers size={17} />} title="Vrstvy" />
              <LayerButton active={selectedLayer === "air-situation"} onClick={() => setSelectedLayer("air-situation")} label="Air situation" count={scopedObjects.length} />
              <LayerButton active={selectedLayer === "uav"} onClick={() => setSelectedLayer("uav")} label="UAV" count={getUavCount(scopedObjects)} />
              <LayerButton active={selectedLayer === "friendly"} onClick={() => setSelectedLayer("friendly")} label="Vlastní" count={metrics.friendlyCount} />
              <LayerButton active={selectedLayer === "foreign"} onClick={() => setSelectedLayer("foreign")} label="Cizí" count={metrics.foreignCount} />
              <LayerButton active={selectedLayer === "data-quality"} onClick={() => setSelectedLayer("data-quality")} label="Data quality" count={getDataQualityCount(scopedObjects)} />

              <div className="control-block">
                <PanelTitle icon={<SlidersHorizontal size={17} />} title="Filtry" />
                <label className="search-field">
                  <Search size={15} />
                  <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Object ID, type, affiliation" />
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={includeSynthetic} onChange={(event) => setIncludeSynthetic(event.target.checked)} />
                  Zobrazit simulované cíle
                </label>
                <label className="range-label">
                  Minimum confidence
                  <input type="range" min="0" max="1" step="0.05" value={minConfidence} onChange={(event) => setMinConfidence(Number(event.target.value))} />
                  <span>{Math.round(minConfidence * 100)} %</span>
                </label>
                <SegmentedControl
                  label="Affiliation"
                  options={[
                    ["all", "All"],
                    ["friend", "Vlastní"],
                    ["hostile", "Cizí"],
                    ["unknown", "Unknown"]
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
              <ReadinessRow label="Vrstva na mapě" value={proximityAlertEnabled ? "aktivní" : "vypnuto"} tone={proximityAlertEnabled ? "ok" : "neutral"} />
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

        <section className="center-column">
          <section className="map-stage">
            <CopMap
              alerts={mapAlerts}
              objects={visibleObjects}
              emptyMessage={mapEmptyMessage}
              selectedLayer={selectedLayer}
              selectedObjectId={selectedObject?.objectId}
              showHistory={showHistory}
              showPrediction={showPrediction}
              trackHistory={replayTrackHistory}
              predictionMinutes={predictionMinutes}
              predictionMode={predictionMode}
              autoFit={autoFit}
              alertRadiusKm={alertRadiusKm}
              focusView={mapView}
              focusViewRequest={focusViewRequest}
              focusUserLocationRequest={focusUserLocationRequest}
              hasProximityAlerts={proximityAlerts.length > 0}
              initialView={mapView}
              onSelectObject={(object) => setSelectedObjectId(object.objectId)}
              onAutoFitChange={setAutoFit}
              onRequestUserLocation={locateUser}
              onViewChange={setMapView}
              showProximityAlertRadius={proximityAlertEnabled}
              userLocation={userLocation}
            />
          </section>

          {showAlertControls ? (
            <section className="operations-deck alert-operations-deck">
              <AlertCenterBoard
                alerts={serverAlerts}
                onAcknowledge={(alertId) => void acknowledgeServerAlert(alertId)}
                onSelectObject={setSelectedObjectId}
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
                  <span>{visibleObjects.length} tracks</span>
                </div>
                <TrackTable objects={visibleObjects} selectedObjectId={selectedObject?.objectId} onSelect={setSelectedObjectId} />
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
          <div className="workspace-context-card">
            <span>Workspace</span>
            <strong>{workspace.label}</strong>
            <p>{workspace.description}</p>
          </div>

          <PanelTitle icon={<Database size={17} />} title="Object detail" />
          {selectedObject ? (
            <ObjectDetail
              historyPoints={replayTrackHistory[selectedObject.objectId] ?? []}
              object={selectedObject}
              replayActive={replayActive}
              sourceHealth={sourceHealth}
            />
          ) : (
            <div className="empty-state">Zatím nejsou přijata žádná COP data. Pošli validní ingest event ze SIM fixture.</div>
          )}

          <div className="readiness-box">
            <PanelTitle icon={<Gauge size={17} />} title="Data readiness" />
            <ReadinessRow label="Source coverage" value={metrics.activeSources > 0 ? "active" : "waiting"} tone={metrics.activeSources > 0 ? "ok" : "warn"} />
            <ReadinessRow label="SIM data visible" value={includeSynthetic ? "enabled" : "hidden"} tone={includeSynthetic ? "ok" : "warn"} />
            <ReadinessRow label="SIM tracks" value={String(metrics.syntheticCount)} tone="neutral" />
            <ReadinessRow label="Stream mode" value={streamReadinessLabel(streamStatus, streamTelemetry)} tone={streamStatusTone(streamStatus)} />
            <ReadinessRow label="Stream latency" value={formatStreamLatency(streamTelemetry.latencyMs)} tone={streamLatencyTone(streamTelemetry)} />
            <ReadinessRow label="Last heartbeat" value={formatStreamObservation(streamTelemetry.lastHeartbeatAt)} tone={streamHeartbeatTone(streamTelemetry)} />
            <ReadinessRow label="Server clients" value={formatServerClientCount(streamHealth, streamTelemetry)} tone={streamServerTone(streamHealth, streamTelemetry)} />
            <ReadinessRow label="Backpressure" value={formatBackpressureState(streamHealth, streamTelemetry)} tone={streamServerTone(streamHealth, streamTelemetry)} />
            <ReadinessRow label="Reconnects" value={String(streamTelemetry.reconnectCount)} tone={streamTelemetry.reconnectCount > 0 ? "warn" : "ok"} />
            {streamTelemetry.lastError ? <ReadinessRow label="Stream error" value={streamTelemetry.lastError} tone="warn" /> : null}
            <ReadinessRow label="User profile" value={profileSyncLabel(profileSyncStatus)} tone={profileSyncTone(profileSyncStatus)} />
            <ReadinessRow label="Fallback sync" value={autoRefresh ? `${refreshSeconds} s` : "manual"} tone={autoRefresh ? "ok" : "neutral"} />
            <ReadinessRow label="Track history" value={showHistory ? `${historyPointCount} pts` : "hidden"} tone={showHistory ? "ok" : "neutral"} />
            <ReadinessRow label="Replay" value={formatReplayStatus(replayTimestamp, replayWindow, replayActive)} tone={replayActive ? "warn" : "neutral"} />
            <ReadinessRow label="Alert Center" value={`${alertSummary.server} server · ${alertSummary.local} local`} tone={alertSummary.total > 0 ? "warn" : "ok"} />
            <ReadinessRow label="History window" value={`${trackHistoryWindowSeconds} s · max ${trackHistoryLimit} pts`} tone="neutral" />
            <ReadinessRow label="Prediction" value={showPrediction ? `${predictionModeLabel(predictionMode)} · ${predictionMinutes} min` : "hidden"} tone={showPrediction ? "ok" : "neutral"} />
            <ReadinessRow label="Policy scope" value="COP data only" tone="neutral" />
          </div>

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

          <div className="ai-box">
            <PanelTitle icon={<Bot size={17} />} title="AI assistant" />
            <p>{aiResult}</p>
            <button className="primary-button" onClick={askAi}>
              <Sparkles size={16} />
              Zkontrolovat kvalitu dat
            </button>
          </div>
        </aside>
      </section>

      {settingsOpen ? (
        <SettingsDrawer
          activeTab={settingsTab}
          alertRadiusKm={alertRadiusKm}
          authConfig={authConfig}
          authSession={authSession}
          autoRefresh={autoRefresh}
          includeSynthetic={includeSynthetic}
          minConfidence={minConfidence}
          predictionMinutes={predictionMinutes}
          predictionMode={predictionMode}
          profileSyncError={profileSyncError}
          profileSyncStatus={profileSyncStatus}
          proximityAlertEnabled={proximityAlertEnabled}
          refreshSeconds={refreshSeconds}
          serverProfileUpdatedAt={serverProfileUpdatedAt}
          showHistory={showHistory}
          showPrediction={showPrediction}
          trackHistoryLimit={trackHistoryLimit}
          trackHistoryWindowSeconds={trackHistoryWindowSeconds}
          onAlertRadiusKmChange={setAlertRadiusKm}
          onAutoRefreshChange={setAutoRefresh}
          onClose={() => setSettingsOpen(false)}
          onIncludeSyntheticChange={setIncludeSynthetic}
          onMinConfidenceChange={setMinConfidence}
          onPredictionMinutesChange={setPredictionMinutes}
          onPredictionModeChange={setPredictionMode}
          onProximityAlertEnabledChange={(value) => void handleProximityAlertToggle(value)}
          onRefreshSecondsChange={setRefreshSeconds}
          onShowHistoryChange={setShowHistory}
          onShowPredictionChange={setShowPrediction}
          onTabChange={setSettingsTab}
          onTrackHistoryLimitChange={setTrackHistoryLimit}
          onTrackHistoryWindowSecondsChange={setTrackHistoryWindowSeconds}
          onLogin={loginOperator}
          onLogout={logoutOperator}
        />
      ) : null}
    </main>
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

function AlertCenterBoard({
  alerts,
  onAcknowledge,
  onSelectObject
}: {
  alerts: CopAlert[];
  onAcknowledge: (alertId: string) => void;
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
            <button className="mini-button" onClick={() => onAcknowledge(alert.alertId)} type="button">
              Potvrdit
            </button>
          </article>
        ))}
      </div>
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
    <nav className="workspace-nav" aria-label="COP workspace">
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
  profiles,
  userScope,
  onApply,
  onSave
}: {
  activeProfileName: string | null;
  profiles: ViewProfile[];
  userScope: string;
  onApply: (profile: ViewProfile) => void;
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
      <button className="mini-button wide save-profile-button" onClick={onSave} type="button">
        <Settings size={14} />
        Uložit aktuální pohled
      </button>
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

function applyCopStreamMessage(
  message: CopStreamMessage,
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
  const observedAt = message.serverTimestamp || new Date().toISOString();
  const observedAtLabel = formatStreamTime(observedAt);
  context.setLastStreamAt(observedAtLabel);
  context.setStreamStatus("live");

  if (message.type === "heartbeat" || message.type === "backpressure" || message.type === "reconnect_required") {
    return;
  }

  const changedObjects = message.changes.map((change) => change.object);
  context.setLastLoadedAt(observedAtLabel);
  context.setObjects((current) => message.type === "snapshot" ? changedObjects : upsertObjects(current, changedObjects));
  context.setTrackHistory((current) =>
    mergeTrackHistory(current, changedObjects, observedAt, context.trackHistoryLimit, context.trackHistoryWindowSeconds)
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
  authConfig,
  authSession,
  autoRefresh,
  includeSynthetic,
  minConfidence,
  predictionMinutes,
  predictionMode,
  profileSyncError,
  profileSyncStatus,
  proximityAlertEnabled,
  refreshSeconds,
  serverProfileUpdatedAt,
  showHistory,
  showPrediction,
  trackHistoryLimit,
  trackHistoryWindowSeconds,
  onAlertRadiusKmChange,
  onAutoRefreshChange,
  onClose,
  onIncludeSyntheticChange,
  onMinConfidenceChange,
  onPredictionMinutesChange,
  onPredictionModeChange,
  onProximityAlertEnabledChange,
  onRefreshSecondsChange,
  onShowHistoryChange,
  onShowPredictionChange,
  onTabChange,
  onTrackHistoryLimitChange,
  onTrackHistoryWindowSecondsChange,
  onLogin,
  onLogout
}: {
  activeTab: SettingsTab;
  alertRadiusKm: number;
  authConfig: AuthConfig;
  authSession: AuthSession;
  autoRefresh: boolean;
  includeSynthetic: boolean;
  minConfidence: number;
  predictionMinutes: number;
  predictionMode: PredictionMode;
  profileSyncError: string | null;
  profileSyncStatus: ProfileSyncStatus;
  proximityAlertEnabled: boolean;
  refreshSeconds: RefreshSeconds;
  serverProfileUpdatedAt: string | null;
  showHistory: boolean;
  showPrediction: boolean;
  trackHistoryLimit: number;
  trackHistoryWindowSeconds: number;
  onAlertRadiusKmChange: (value: number) => void;
  onAutoRefreshChange: (value: boolean) => void;
  onClose: () => void;
  onIncludeSyntheticChange: (value: boolean) => void;
  onMinConfidenceChange: (value: number) => void;
  onPredictionMinutesChange: (value: number) => void;
  onPredictionModeChange: (value: PredictionMode) => void;
  onProximityAlertEnabledChange: (value: boolean) => void;
  onRefreshSecondsChange: (value: RefreshSeconds) => void;
  onShowHistoryChange: (value: boolean) => void;
  onShowPredictionChange: (value: boolean) => void;
  onTabChange: (value: SettingsTab) => void;
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
            ["awareness", "Poloha"],
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
              <PanelTitle icon={<History size={17} />} title="Historie a predikce" />
              <label className="toggle-row">
                <input type="checkbox" checked={showHistory} onChange={(event) => onShowHistoryChange(event.target.checked)} />
                Historie trasy
              </label>
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
                Zobrazit simulované cíle
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
              <PanelTitle icon={<MapPin size={17} />} title="Poloha a výstrahy" />
              <label className="toggle-row">
                <input type="checkbox" checked={proximityAlertEnabled} onChange={(event) => onProximityAlertEnabledChange(event.target.checked)} />
                Výstraha při přiblížení cizího cíle
              </label>
              <label className="range-label">
                Poloměr výstrahy
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
            </section>
          ) : null}

          {activeTab === "account" ? (
            <section className="settings-section">
              <PanelTitle icon={<UserCircle size={17} />} title="Přihlášení" />
              <ReadinessRow label="Stav" value={authStatusLabel(authSession, authConfig)} tone={authSession.status === "authenticated" ? "ok" : "neutral"} />
              <ReadinessRow label="Profil" value={authSession.profile?.name ?? "nepřihlášen"} tone="neutral" />
              <ReadinessRow label="Provider" value={isOidcEnabled(authConfig) ? "Keycloak" : "lab token"} tone="neutral" />
              <ReadinessRow label="Realm" value={authConfig.issuer ? authConfig.issuer.split("/").pop() ?? "n/a" : "n/a"} tone="neutral" />
              <ReadinessRow label="Serverový profil" value={profileSyncLabel(profileSyncStatus)} tone={profileSyncTone(profileSyncStatus)} />
              <ReadinessRow label="Uloženo" value={formatProfileUpdatedAt(serverProfileUpdatedAt)} tone="neutral" />
              {isOidcEnabled(authConfig) ? (
                authSession.status === "authenticated" ? (
                  <button className="primary-button secondary" onClick={onLogout} type="button">
                    <LogOut size={16} />
                    Odhlásit
                  </button>
                ) : (
                  <button className="primary-button" onClick={onLogin} type="button">
                    <LogIn size={16} />
                    Přihlásit přes Keycloak
                  </button>
                )
              ) : (
                <div className="empty-mini">Keycloak není v této build konfiguraci zapnutý. Aplikace běží v laboratorním token režimu.</div>
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

function LayerButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button className={`layer-button ${active ? "active" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
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

function TrackTable({
  objects,
  selectedObjectId,
  onSelect
}: {
  objects: CopObject[];
  selectedObjectId?: string;
  onSelect: (objectId: string) => void;
}) {
  if (objects.length === 0) {
    return <div className="empty-state compact">Žádné objekty neodpovídají aktivním filtrům.</div>;
  }

  return (
    <div className="track-table" role="table" aria-label="COP track list">
      <div className="track-table-head" role="row">
        <span>ID</span>
        <span>Type</span>
        <span>Affiliation</span>
        <span>Confidence</span>
      </div>
      {objects.slice(0, 10).map((object) => {
        const affiliation = getAffiliationPresentation(object.affiliation);
        return (
          <button
            className={`track-row ${object.objectId === selectedObjectId ? "selected" : ""}`}
            key={object.objectId}
            onClick={() => onSelect(object.objectId)}
            role="row"
            type="button"
          >
            <span>{object.objectId}</span>
            <span>{object.objectType}</span>
            <span>
              <i className={`affiliation-dot ${affiliation.disposition}`} />
              {object.affiliation}
            </span>
            <span>{Math.round((object.confidence ?? 0) * 100)} %</span>
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
        {(object.confidence ?? 0) < 0.5 ? <span className="warning-badge">LOW CONFIDENCE</span> : null}
        {model.conflicts.some((conflict) => conflict.severity === "warn") ? <span className="warning-badge">DATA CONFLICT</span> : null}
      </div>
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
  const normalizedQuery = searchQuery.trim().toLowerCase();
  return objects.filter((object) => {
    if (affiliationScope !== "all" && getAffiliationPresentation(object.affiliation).disposition !== affiliationScope) {
      return false;
    }
    if (domainScope !== "all" && object.domain !== domainScope) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [object.objectId, object.objectType, object.affiliation, object.domain, object.status]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
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

function buildMapEmptyMessage({
  loadError,
  objects,
  replayActive,
  scopedObjects,
  sources,
  visibleObjects
}: {
  loadError: string | null;
  objects: CopObject[];
  replayActive: boolean;
  scopedObjects: CopObject[];
  sources: SourceSystem[];
  visibleObjects: CopObject[];
}): string {
  if (loadError) {
    return `COP API není dostupné: ${loadError}`;
  }
  if (replayActive && objects.length === 0) {
    return "Zvolený čas replaye neobsahuje žádné tracky. Posuň časovou osu nebo přepni zpět na live.";
  }
  if (objects.length > 0 && visibleObjects.length === 0) {
    return scopedObjects.length > 0
      ? "Aktivní mapová vrstva neobsahuje žádné tracky."
      : "Aktivní filtry skrývají všechny přijaté COP tracky.";
  }
  if (hasActiveSimSource(sources)) {
    return "SIM zdroj je připojený, ale COP nemá žádné aktivní georeferencované tracky. Spusť scénář v SIM.";
  }
  if (sources.length > 0) {
    return "Source Registry je dostupný, ale zatím nejsou přijaty aktivní georeferencované tracky.";
  }
  return "Čekám na georeferencované COP tracky.";
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
    DISABLED: "disabled",
    ONLINE: "online",
    QUIET: "quiet",
    STALE: "stale",
    WAITING: "waiting"
  };
  return labels[status];
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
  return ["air-situation", "uav", "friendly", "foreign", "data-quality"].includes(value ?? "")
    ? (value as CopLayer)
    : "air-situation";
}

function readInitialAffiliationScope(value: string | undefined): AffiliationScope {
  return ["all", "friend", "hostile", "neutral", "unknown"].includes(value ?? "")
    ? (value as AffiliationScope)
    : "all";
}

function readInitialDomainScope(value: string | undefined): DomainScope {
  return ["all", "AIR", "LAND", "SEA", "RESCUE", "OTHER"].includes(value ?? "") ? (value as DomainScope) : "all";
}

function readInitialPredictionMode(value: string | undefined): PredictionMode {
  return predictionModeOptions.some(([option]) => option === value) ? (value as PredictionMode) : "adaptive";
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

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
