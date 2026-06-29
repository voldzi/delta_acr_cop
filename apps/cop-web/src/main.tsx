import React from "react";
import { createRoot } from "react-dom/client";
import clsx from "clsx";
import * as QRCode from "qrcode";
import {
  Activity,
  AlertTriangle,
  BellRing,
  BookOpen,
  Bot,
  Building2,
  Bus,
  Camera,
  CheckCircle2,
  Clock3,
  CloudSun,
  ChevronDown,
  ClipboardList,
  Copy,
  Crosshair,
  Database,
  ExternalLink,
  FileText,
  Gauge,
  HelpCircle,
  History,
  Image,
  Layers,
  Languages,
  Link2,
  ListFilter,
  LogIn,
  LogOut,
  MapPin,
  MessageCircle,
  MonitorUp,
  MousePointer2,
  Move,
  PanelLeftClose,
  PanelRightClose,
  Pause,
  PenLine,
  Pin,
  PinOff,
  Plane,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  RadioTower,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Smartphone,
  Trash2,
  UserCircle,
  X,
  Wifi
} from "lucide-react";
import {
  authSessionStorageKey,
  beginLogin,
  createInitialAuthSession,
  endSession,
  getAuthorizationToken,
  hasOidcCallbackParams,
  initializeAuth,
  isAuthSessionActive,
  isOidcEnabled,
  plannedAuthRefreshDelayMs,
  readAuthDiagnostics,
  recordAuthDiagnosticEvent,
  readAuthConfig,
  refreshAuthSession,
  shouldExpireAuthSessionAfterRefreshFailure,
  subjectIdFromAuthSession,
  subjectIdFromStoredAuthValue,
  type AuthConfig,
  type AuthDiagnostics,
  type AuthSession
} from "./auth";
import {
  acknowledgeCopAlert,
  connectCopStream,
  confirmMobilePairingSession,
  createIncident,
  createIncidentTask,
  createCommunityAttachmentUpload,
  createCommunityGroup,
  createCommunityReport,
  createMobilePairingSession,
  createRadioProfile,
  createSketchDrawing,
  deleteCommunityGroup,
  deleteCommunityReport,
  deleteSketchDrawing,
  fetchCopDashboardData,
  fetchCopAlerts,
  fetchIncidentFusionSuggestions,
  fetchIncidentTasks,
  fetchIncidents,
  fetchMapCatalog,
  fetchMapFeatures,
  fetchMessagingBootstrap,
  fetchMobileDevices,
  fetchMobilePairingSession,
  fetchMobileTowerViewshed,
  fetchPlaceGeocode,
  fetchRadioProfiles,
  fetchSafetyHydroStationDetail,
  fetchWeatherStationDetail,
  fetchDemoScenarioStatus,
  fetchSketchDrawings,
  fetchUserProfile,
  fetchWeatherRadarFrames,
  filterObjectsByLayers,
  filterVisibleObjects,
  copLayerIds,
  getDataQualityCount,
  getPublicFlightCount,
  getSimulatedAirCount,
  getUavCount,
  isPublicFlightObject,
  saveUserProfile,
  seedDemoScenario,
  submitCommunityReport,
  resetDemoScenario,
  revokeMobileDevice,
  runRadioCoverage,
  runRadioLinkCheck,
  runRadioSiteSearch,
  updateCommunityGroupMetadata,
  updateSketchDrawing,
  updateCommunityReport,
  updateIncident,
  updateIncidentTask,
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
  type CommunityReport,
  type DemoScenarioResponse,
  type CommunityReportCategory,
  type CommunityReportHazardSeverity,
  type CommunityReportLocation,
  type CommunityMediaAccessMode,
  type CommunityMediaAccessPolicy,
  type CommunityVideoSpatialMode,
  type FlightDataAttributes,
  type FlightReferenceFeatureCollectionResponse,
  type HealthStatus,
  type HydroSeriesId,
  type HydroStationDetailResponse,
  type IncidentFusionSuggestion,
  type IncidentRecord,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentTaskRecord,
  type IncidentTaskStatus,
  type MapCatalogLayer,
  type MapCatalogResponse,
  type MapCatalogSource,
  type MapBounds,
  type MobileTowerViewshedResponse,
  type MobileDeviceRecord,
  type MobilePairingSessionResponse,
  type MissionArenaFeatureCollectionResponse,
  type ObjectProvenance,
  type PlaceGeocodeResult,
  type RadioCoverageRequest,
  type RadioFeatureCollectionResponse,
  type RadioLinkCheckRequest,
  type RadioLinkCheckResponse,
  type RadioPoint,
  type RadioProfile,
  type RadioProfilesResponse,
  type RadioSiteSearchRequest,
  type SourceHealthItem,
  type SourceSystem,
  type SafetyDataSourceId,
  type SafetyConfigResponse,
  type SafetyFeature,
  type SafetyFeatureCollectionResponse,
  type SafetyLayer,
  type SafetyLayerId,
  type SafetySourceDescriptor,
  type SketchDrawingFeature,
  type SketchDrawingPayload,
  type SituationFeature,
  type SituationFeatureCollectionResponse,
  type SituationLayer,
  type SituationLayerId,
  type SituationSourceDescriptor,
  type TakFeature,
  type TakFeatureCollectionResponse,
  type TakLayer,
  type TakLayerId,
  type TakSourceDescriptor,
  type WeatherRadarFrame,
  type WeatherStationAttribution,
  type WeatherStationChart,
  type WeatherStationDetailResponse
} from "./cop-data";
import { CopMap, formatTrackLabel, type CreateSketchDrawingRequest, type SketchToolMode, type UpdateSketchDrawingRequest } from "./CopMap";
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
  applyChatUnreadPayload,
  fetchMatrixUnreadCount,
  getOrCreateMatrixDeviceId,
  publishChatUnreadCount,
  readStoredChatUnreadCount
} from "@cop/messaging/runtime";
import { decodeChatCenterLocation, encodeChatSelect } from "@cop/messaging/bridge";
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
  normalizeAlertPreferences,
  normalizeMapView,
  normalizeUserPreferences,
  readLocalAlertPreferences,
  readUserPreferences,
  writeLocalAlertPreferences,
  writeUserPreferences,
  type AppLanguage,
  type MapBasemapMode,
  type MapViewState,
  type OperatorProfilePreferences,
  type PublicFlightSymbolMode,
  type TrackHistoryDisplayMode,
  type UserPreferences,
  type WorkspaceLayoutPreferences,
  type WorkspacePanelMode,
  type WorkspaceSkin
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
  isMobileNetworkModelEstimate,
  mobileNetworkBasisLabels,
  mobileNetworkBtsStatusLabel,
  mobileNetworkBtsStatusNotice,
  mobileNetworkDataQualityLabel,
  mobileNetworkOperationalModeLabel,
  mobileNetworkModelExplanation,
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
import {
  disableWebPushNotifications,
  enableWebPushNotifications,
  fetchWebPushConfig,
  readWebPushPermissionState,
  type WebPushUiState
} from "./web-push";
import "./styles.css";

const apiBase = import.meta.env.VITE_COP_API_BASE_URL ?? "";
const labToken = import.meta.env.VITE_COP_PUBLIC_LAB_VALUE ?? (import.meta.env.DEV ? "dev-lab-token" : "");
const defaultRefreshSeconds = refreshMillisecondsToSeconds(import.meta.env.VITE_COP_REFRESH_MS ?? "5000");
const TrackTable = React.lazy(() => import("./TrackTable"));
const XrWorkspace = React.lazy(() => import("./XrWorkspace"));

type AffiliationScope = "all" | "friend" | "hostile" | "neutral" | "unknown";
type DomainScope = "all" | "AIR" | "LAND" | "SEA" | "RESCUE" | "OTHER";
type OperatingMode = "DEGRADED" | "OFFLINE" | "ONLINE";
type OfflineSnapshotState =
  | { kind: "active"; objectCount: number; reason: string; restoredAt: string; savedAt: string; sourceCount: number }
  | { kind: "available"; objectCount: number; savedAt: string; sourceCount: number }
  | { kind: "none" };
type PreferenceSettings = ViewProfileSettings | UserPreferences;
type SettingsTab = "map" | "data" | "workspace" | "awareness" | "account";
type WorkspaceTemplateId = "civil" | "operations" | "field";
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
  ["dark", "Tmavá"],
  ["outline", "Hranice"]
];
const appLanguageOptions: Array<[AppLanguage, string]> = [
  ["cs", "Čeština"],
  ["en", "English"]
];
const defaultSituationLayerIds: SituationLayerId[] = ["weather"];
const defaultSafetyLayerIds: SafetyLayerId[] = ["warnings"];
const publicSafetyAlertLayerIds = new Set(["warnings", "weather_alerts", "fire", "flood"]);
const defaultTakLayerIds: TakLayerId[] = [];
const pocDemoScenarioId = "flood-central-bohemia";
const zoneColorOptions = ["#8cb6d8", "#c8f08d", "#facc15", "#fb923c", "#ef4444", "#a78bfa"] as const;
const predictionModeOptions: Array<[PredictionMode, string]> = [
  ["adaptive", "Adaptivní"],
  ["telemetry", "Telemetrie"],
  ["history", "Trend"],
  ["maneuver", "Manévr"]
];
const defaultAoiCenter = { lat: 50.0755, lon: 14.4378 };
const mapFeatureFetchDelayMs = 450;
const defaultMapBounds: MapBounds = { east: 19.1, north: 51.2, south: 48.5, west: 12 };
const messagingDockWidthStorageKey = "cop.messaging.dockWidth.v1";

interface StableFeatureRequest {
  bounds: MapBounds;
  key: string;
}

const defaultWorkspaceLayout: Required<WorkspaceLayoutPreferences> = {
  contextRailVisible: false,
  leftPanelMode: "open",
  leftPanelWidth: 300,
  rightPanelMode: "open",
  rightPanelWidth: 360,
  statusbarVisible: true
};
const workspaceLeftWidthRange = { max: 460, min: 220 };
const workspaceRightWidthRange = { max: 560, min: 280 };
const messagingDockWidthRange = { max: 760, min: 560 };
const workspaceSkinOptions: Array<[WorkspaceSkin, string]> = [
  ["civil", "Civilní"],
  ["operations", "Operační"],
  ["field", "Terénní"]
];
const workspaceTemplateCards: Array<{
  description: string;
  id: WorkspaceTemplateId;
  title: string;
  tone: string;
}> = [
  {
    description: "Pro občany a veřejné sdílení: civilní ikony, čitelný podklad, méně rušivé panely.",
    id: "civil",
    title: "Civilní",
    tone: "Klidný informační režim"
  },
  {
    description: "Pro dispečink a krizový štáb: hustší rozložení, detail, zdroje, stav a profesionální symbolika.",
    id: "operations",
    title: "Operační",
    tone: "Řídicí pracoviště"
  },
  {
    description: "Pro mobilní a terénní použití: maximum mapy, sbalené panely, výraznější kontrast a výstražné vrstvy.",
    id: "field",
    title: "Terénní",
    tone: "Mapa v popředí"
  }
];
type HelpSection = "overview" | "layout" | "layers" | "profile" | "reports" | "alerts";

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

interface TechnicalAlertSummary {
  conflicts: number;
  lifecycle: number;
  lowConfidence: number;
  sourceDegraded: number;
  total: number;
}

type PriorityAlertTone = "critical" | "neutral" | "ok" | "warn";

interface PriorityAlertCandidate {
  badge: string;
  confidence: number;
  detail: string;
  distanceKm?: number;
  id: string;
  observedAt?: string;
  score: number;
  severityRank: number;
  sourceKind: "alert" | "feature" | "object" | "proximity";
  title: string;
  tone: PriorityAlertTone;
  validUntil?: string;
}

interface PriorityAlertSummary {
  additionalCount: number;
  primary: PriorityAlertCandidate | null;
  reference: {
    lat: number;
    lon: number;
    source: "default" | "map" | "user";
  };
  total: number;
}

type MobileSheet = "layers" | "detail" | null;
const MOBILE_SHEET_MEDIA_QUERY = "(max-width: 860px)";

function isMobileSheetViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MOBILE_SHEET_MEDIA_QUERY).matches;
}

interface AccountChangeNotice {
  kind: "changed" | "cleared";
}

type RadioLosMode = "coverage" | "link" | "site";
type RadioPointPickTarget = "station" | "from" | "to" | "site-target";
type RadioLosStatus = "idle" | "loading" | "loaded" | "error";

interface RadioLosMapOverlay {
  features: SituationFeature[];
  mode: RadioLosMode;
  title: string;
  warnings: string[];
}

interface RadioLosResult {
  collection?: RadioFeatureCollectionResponse;
  error?: string;
  link?: RadioLinkCheckResponse;
  mode: RadioLosMode;
  status: RadioLosStatus;
  title: string;
  warnings: string[];
}

const radioLosDisclaimer = "Výsledek je modelový odhad podle DEM a zadaných parametrů rádia. Nezahrnuje budovy, vegetaci, rušení, reálné vytížení sítě ani utajené/operátorské RF parametry.";

const fallbackRadioProfile: RadioProfile = { antennaHeightM: 1.5, frequencyMhz: 446, maxRadiusM: 5000, name: "PMR446 ruční stanice", profileId: "pmr446_handheld", receiverHeightM: 1.5, txPowerW: 0.5 };

const defaultRadioProfiles: RadioProfile[] = [
  fallbackRadioProfile,
  { antennaHeightM: 2, frequencyMhz: 27, maxRadiusM: 15000, name: "CB handheld/vehicle", profileId: "cb_vehicle", receiverHeightM: 2, txPowerW: 4 },
  { antennaHeightM: 1.5, frequencyMhz: 145, maxRadiusM: 15000, name: "HAM VHF handheld", profileId: "ham_vhf_handheld", receiverHeightM: 1.5, txPowerW: 5 },
  { antennaHeightM: 1.5, frequencyMhz: 433, maxRadiusM: 10000, name: "HAM UHF handheld", profileId: "ham_uhf_handheld", receiverHeightM: 1.5, txPowerW: 5 },
  { antennaHeightM: 10, frequencyMhz: 145, maxRadiusM: 40000, name: "HAM VHF base", profileId: "ham_vhf_base", receiverHeightM: 10, txPowerW: 25 },
  { antennaHeightM: 5, frequencyMhz: 2400, maxRadiusM: 10000, name: "WiFi 2.4 GHz PtP", profileId: "wifi_24_ptp", receiverHeightM: 5, txPowerW: 0.1 },
  { antennaHeightM: 1.5, frequencyMhz: 390, maxRadiusM: 12000, name: "TETRA generic handheld", profileId: "tetra_generic_handheld", receiverHeightM: 1.5, txPowerW: 1 },
  { antennaHeightM: 2, frequencyMhz: 50, maxRadiusM: 25000, name: "Generic VHF manpack", profileId: "generic_vhf_manpack", receiverHeightM: 2, txPowerW: 5 },
  { antennaHeightM: 3, frequencyMhz: 50, maxRadiusM: 40000, name: "Generic VHF vehicle", profileId: "generic_vhf_vehicle", receiverHeightM: 3, txPowerW: 25 },
  { antennaHeightM: 10, frequencyMhz: 50, maxRadiusM: 60000, name: "Generic elevated relay", profileId: "generic_elevated_relay", receiverHeightM: 10, txPowerW: 25 }
];

const defaultRadioPoint: RadioPoint = { antennaHeightM: 1.5, lat: 50.08, lon: 14.42, receiverHeightM: 1.5 };

export function App() {
  const authConfig = React.useMemo(() => readAuthConfig(), []);
  const [authSession, setAuthSession] = React.useState<AuthSession>(() => createInitialAuthSession(authConfig));
  const [authRefreshRetry, setAuthRefreshRetry] = React.useState(0);
  const [authDiagnostics, setAuthDiagnostics] = React.useState<AuthDiagnostics>(() => readAuthDiagnostics());
  const userStorageScope = React.useMemo(
    () => userPreferenceScope(authSession),
    [authSession.profile?.subjectId, authSession.profile?.username, authSession.status]
  );
  const [offlineSnapshotState, setOfflineSnapshotState] = React.useState<OfflineSnapshotState>(() =>
    initialOfflineSnapshotState(userStorageScope)
  );
  const initialPreferences = React.useMemo(() => readUserPreferences(userStorageScope), [userStorageScope]);
  const initialAlertPreferences = React.useMemo(() => readLocalAlertPreferences(userStorageScope), [userStorageScope]);
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
  const [mobileSheet, setMobileSheet] = React.useState<MobileSheet>(null);
  const [mobileSheetViewport, setMobileSheetViewport] = React.useState(() => isMobileSheetViewport());
  const [mobileSketchOpen, setMobileSketchOpen] = React.useState(false);
  const shellRef = React.useRef<HTMLElement | null>(null);
  const [workspaceResizeActive, setWorkspaceResizeActive] = React.useState(false);
  const [workspaceLayout, setWorkspaceLayout] = React.useState<Required<WorkspaceLayoutPreferences>>(() =>
    normalizeWorkspaceLayout(initialPreferences.workspaceLayout)
  );
  const [workspaceSkin, setWorkspaceSkin] = React.useState<WorkspaceSkin>(() =>
    normalizeWorkspaceSkin(initialPreferences.workspaceSkin)
  );
  const [operatorProfile, setOperatorProfile] = React.useState<OperatorProfilePreferences>(() =>
    initialOperatorProfile(authSession, initialPreferences.operatorProfile)
  );
  const [helpSection, setHelpSection] = React.useState<HelpSection | null>(null);
  const [placeSearchItems, setPlaceSearchItems] = React.useState<PlaceGeocodeResult[]>([]);
  const [placeSearchLoading, setPlaceSearchLoading] = React.useState(false);
  const [placeSearchError, setPlaceSearchError] = React.useState<string | null>(null);
  const [radioMode, setRadioMode] = React.useState<RadioLosMode>("coverage");
  const [radioProfiles, setRadioProfiles] = React.useState<RadioProfile[]>(defaultRadioProfiles);
  const [radioProfilesStatus, setRadioProfilesStatus] = React.useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [radioProfilesError, setRadioProfilesError] = React.useState<string | null>(null);
  const [radioProfileId, setRadioProfileId] = React.useState("pmr446_handheld");
  const [radioUseCustomProfile, setRadioUseCustomProfile] = React.useState(false);
  const [radioCustomProfile, setRadioCustomProfile] = React.useState<RadioProfile>({
    antennaHeightM: 1.5,
    frequencyMhz: 446,
    maxRadiusM: 5000,
    name: "Vlastní rádio",
    receiverHeightM: 1.5,
    systemLossDb: 2,
    txPowerW: 0.5
  });
  const [radioStation, setRadioStation] = React.useState<RadioPoint>(defaultRadioPoint);
  const [radioLinkFrom, setRadioLinkFrom] = React.useState<RadioPoint>(defaultRadioPoint);
  const [radioLinkTo, setRadioLinkTo] = React.useState<RadioPoint>({ antennaHeightM: 1.5, lat: 50.11, lon: 14.51, receiverHeightM: 1.5 });
  const [radioSearchTargets, setRadioSearchTargets] = React.useState<RadioPoint[]>([{ lat: 50.08, lon: 14.42, receiverHeightM: 1.5 }]);
  const [radioGridStepM, setRadioGridStepM] = React.useState(250);
  const [radioRadiusM, setRadioRadiusM] = React.useState(5000);
  const [radioResult, setRadioResult] = React.useState<RadioLosResult>({ mode: "coverage", status: "idle", title: "Radio LoS", warnings: [] });
  const [radioOverlay, setRadioOverlay] = React.useState<RadioLosMapOverlay | null>(null);
  const [radioPointPickTarget, setRadioPointPickTarget] = React.useState<RadioPointPickTarget | null>(null);
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
  const [language, setLanguage] = React.useState<AppLanguage>(() => normalizeAppLanguage(initialPreferences.language));
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
  const [demoScenario, setDemoScenario] = React.useState<DemoScenarioResponse | null>(null);
  const [demoScenarioBusy, setDemoScenarioBusy] = React.useState<"loading" | "resetting" | "seeding" | null>(null);
  const [demoScenarioError, setDemoScenarioError] = React.useState<string | null>(null);
  const [activeCatalogGroupId, setActiveCatalogGroupId] = React.useState<string | null>(null);
  const [visibleCatalogLayerIds, setVisibleCatalogLayerIds] = React.useState<string[]>(() =>
    normalizeCatalogLayerIds(initialPreferences.catalogLayerIds)
  );
  const [zoneCreationMode, setZoneCreationMode] = React.useState(false);
  const [editingZoneId, setEditingZoneId] = React.useState<string | null>(null);
  const [autoFit, setAutoFit] = React.useState(initialPreferences.autoFit ?? true);
  const [mapView, setMapView] = React.useState<MapViewState | undefined>(() => normalizeMapView(initialPreferences.mapView));
  const [mapBounds, setMapBounds] = React.useState<MapBounds>(defaultMapBounds);
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
  const [weatherWebcamDetailCache, setWeatherWebcamDetailCache] = React.useState<Record<string, WeatherWebcamDetailCacheEntry>>({});
  const [situationRasterRefreshTick, setSituationRasterRefreshTick] = React.useState(0);
  const [weatherRadarFrames, setWeatherRadarFrames] = React.useState<WeatherRadarFrame[]>([]);
  const [weatherRadarFrameIndex, setWeatherRadarFrameIndex] = React.useState(0);
  const [weatherRadarFrameCatalogTick, setWeatherRadarFrameCatalogTick] = React.useState(0);
  const [weatherRadarPlaybackEnabled, setWeatherRadarPlaybackEnabled] = React.useState(true);
  const [weatherRadarPlaybackStatus, setWeatherRadarPlaybackStatus] = React.useState<SituationLayerStatus>("disabled");
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
  const [sketchDrawings, setSketchDrawings] = React.useState<SketchDrawingFeature[]>([]);
  const [sketchMode, setSketchMode] = React.useState<SketchToolMode>("pan");
  const [selectedSketchDrawingId, setSelectedSketchDrawingId] = React.useState<string | null>(null);
  const [sketchStatus, setSketchStatus] = React.useState<SituationLayerStatus>("disabled");
  const [sketchWarnings, setSketchWarnings] = React.useState<string[]>([]);
  const [communityReportOpen, setCommunityReportOpen] = React.useState(false);
  const [communityReportDraft, setCommunityReportDraft] = React.useState<CommunityReportDraft>(() => createCommunityReportDraft());
  const [communityReportSubmitting, setCommunityReportSubmitting] = React.useState(false);
  const [communityReportError, setCommunityReportError] = React.useState<string | null>(null);
  const [communityReportSuccess, setCommunityReportSuccess] = React.useState<string | null>(null);
  const [communityUploadProgress, setCommunityUploadProgress] = React.useState<CommunityUploadUiState | null>(null);
  const [communityReportLocationPickMode, setCommunityReportLocationPickMode] = React.useState(false);
  const [communityRefreshNonce, setCommunityRefreshNonce] = React.useState(0);
  const [communityGallery, setCommunityGallery] = React.useState<CommunityGalleryState | null>(null);
  const [loginPromptReason, setLoginPromptReason] = React.useState<LoginPromptReason | null>(null);
  const [accountChangeNotice, setAccountChangeNotice] = React.useState<AccountChangeNotice | null>(null);
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
  const [alertPreferences, setAlertPreferences] = React.useState<AlertPreferences>(() => initialAlertPreferences.alertPreferences);
  const [, setLocalAlertPreferencesUpdatedAt] = React.useState<string | null>(() => initialAlertPreferences.updatedAt);
  const [profileSyncStatus, setProfileSyncStatus] = React.useState<ProfileSyncStatus>("loading");
  const [profileSyncError, setProfileSyncError] = React.useState<string | null>(null);
  const [serverProfileUpdatedAt, setServerProfileUpdatedAt] = React.useState<string | null>(null);
  const [messagingOpen, setMessagingOpen] = React.useState(false);
  const [messagingPinned, setMessagingPinned] = React.useState(false);
  const [messagingDockWidth, setMessagingDockWidth] = React.useState(() => readMessagingDockWidth());
  const [messagingSelection, setMessagingSelection] = React.useState<MessagingSelectionCommand | null>(null);
  const [messagingUnreadCount, setMessagingUnreadCount] = React.useState(0);
  const messagingSelectionNonceRef = React.useRef(0);
  const [webPushState, setWebPushState] = React.useState<WebPushUiState>(() => readWebPushPermissionState());
  const [webPushBusy, setWebPushBusy] = React.useState(false);
  const [incidentSuggestions, setIncidentSuggestions] = React.useState<IncidentFusionSuggestion[]>([]);
  const [incidents, setIncidents] = React.useState<IncidentRecord[]>([]);
  const [incidentTasksById, setIncidentTasksById] = React.useState<Record<string, IncidentTaskRecord[]>>({});
  const [selectedIncidentId, setSelectedIncidentId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const applyUnread = (value: unknown) => applyChatUnreadPayload(value, setMessagingUnreadCount);
    const hydrateStoredUnread = () => {
      const count = readStoredChatUnreadCount();
      if (count !== null) {
        setMessagingUnreadCount(count);
      }
    };
    const handleChatMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object" || Array.isArray(event.data)) {
        return;
      }
      const data = event.data as { count?: unknown; lat?: unknown; lon?: unknown; type?: unknown };
      if (applyUnread(data)) {
        return;
      }
      const center = decodeChatCenterLocation(data);
      if (center) {
        setActiveWorkspace("map");
        setAutoFit(false);
        setMapView((current) => ({
          bearing: current?.bearing ?? 0,
          center: [center.lon, center.lat],
          pitch: current?.pitch ?? 0,
          zoom: Math.max(current?.zoom ?? 0, 15)
        }));
        setFocusViewRequest((current) => current + 1);
      }
    };
    const handleChatStorage = (event: StorageEvent) => {
      if (event.key !== "cop.chat.unread.v1" || !event.newValue) {
        return;
      }
      try {
        applyUnread(JSON.parse(event.newValue) as unknown);
      } catch {
        // Ignore malformed external values.
      }
    };
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel("cop-chat");
        channel.addEventListener("message", (event) => {
          applyUnread(event.data);
        });
      } catch {
        channel = null;
      }
    }
    hydrateStoredUnread();
    window.addEventListener("message", handleChatMessage);
    window.addEventListener("storage", handleChatStorage);
    return () => {
      channel?.close();
      window.removeEventListener("message", handleChatMessage);
      window.removeEventListener("storage", handleChatStorage);
    };
  }, []);
  const [incidentTaskDraft, setIncidentTaskDraft] = React.useState("");
  const [incidentWorkflowLoading, setIncidentWorkflowLoading] = React.useState(false);
  const [incidentWorkflowError, setIncidentWorkflowError] = React.useState<string | null>(null);
  const [incidentWorkflowStatus, setIncidentWorkflowStatus] = React.useState<string | null>(null);
  const [aiResult, setAiResult] = React.useState("AI asistent je připraven zkontrolovat kvalitu zobrazených dat.");
  const loadInFlightRef = React.useRef(false);
  const catalogSelectionInitializedRef = React.useRef(initialPreferences.catalogLayerIds !== undefined);
  const situationFeatureRequestRef = React.useRef<StableFeatureRequest | null>(null);
  const profileHydratedRef = React.useRef(false);
  const profileLoadKeyRef = React.useRef<string | null>(null);
  const profileSaveTimerRef = React.useRef<number | undefined>(undefined);
  const skipNextAlertPreferenceWriteRef = React.useRef(false);
  const skipNextPreferenceWriteRef = React.useRef(false);
  const notifiedProximityAlertsRef = React.useRef<Set<string>>(new Set());
  const authToken = getAuthorizationToken(authSession, labToken);
  const authenticatedSessionActive = isAuthSessionActive(authSession);
  const dataAccessReady = authConfig.publicReadEnabled || Boolean(authToken);
  const profileAccessReady = Boolean(authToken);
  const mobilePairCodeFromPath = React.useMemo(readMobilePairCodeFromLocation, []);
  const messagingAuthenticated = authenticatedSessionActive;
  const authSubjectId = subjectIdFromAuthSession(authSession);

  React.useEffect(() => {
    if (!authenticatedSessionActive || !authToken || messagingOpen) {
      return undefined;
    }
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const ownerId = authSubjectId ?? authSession.profile?.username ?? "anonymous";
    const refreshUnread = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const bootstrap = await fetchMessagingBootstrap(apiBase, authToken, getOrCreateMatrixDeviceId(ownerId));
        const count = await fetchMatrixUnreadCount(bootstrap, controller.signal);
        if (!cancelled) {
          setMessagingUnreadCount(count);
          publishChatUnreadCount(count);
        }
      } catch {
        // The chat panel is the authoritative UI; the shell badge monitor is best effort.
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(refreshUnread, 15_000);
        }
      }
    };
    const storedCount = readStoredChatUnreadCount();
    if (storedCount !== null) {
      setMessagingUnreadCount(storedCount);
    }
    void refreshUnread();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [authSession.profile?.username, authSubjectId, authToken, authenticatedSessionActive, messagingOpen]);

  React.useEffect(() => {
    let cancelled = false;
    void fetchWebPushConfig(apiBase)
      .then((nextState) => {
        if (!cancelled) {
          setWebPushState(nextState);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWebPushState((current) => ({
            ...current,
            status: "degraded",
            warnings: [error instanceof Error ? error.message : "Nepodařilo se načíst nastavení webových notifikací."]
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnableWebPush = React.useCallback(async () => {
    if (!authenticatedSessionActive || !authToken) {
      setWebPushState((current) => ({
        ...current,
        warnings: ["Webové notifikace vyžadují přihlášení."]
      }));
      return;
    }

    setWebPushBusy(true);
    try {
      setWebPushState(await enableWebPushNotifications(apiBase, authToken));
    } catch (error) {
      setWebPushState((current) => ({
        ...current,
        status: "degraded",
        warnings: [error instanceof Error ? error.message : "Registrace webových notifikací selhala."]
      }));
    } finally {
      setWebPushBusy(false);
    }
  }, [authToken, authenticatedSessionActive]);

  const handleDisableWebPush = React.useCallback(async () => {
    if (!authenticatedSessionActive || !authToken) {
      setWebPushState((current) => ({
        ...current,
        registered: false,
        warnings: ["Webové notifikace nejsou pro veřejný režim aktivní."]
      }));
      return;
    }

    setWebPushBusy(true);
    try {
      setWebPushState(await disableWebPushNotifications(apiBase, authToken));
    } catch (error) {
      setWebPushState((current) => ({
        ...current,
        status: "degraded",
        warnings: [error instanceof Error ? error.message : "Odhlášení webových notifikací selhalo."]
      }));
    } finally {
      setWebPushBusy(false);
    }
  }, [authToken, authenticatedSessionActive]);

  React.useEffect(() => {
    setAuthDiagnostics(readAuthDiagnostics());
  }, [authSession.expiresAt, authSession.profile?.subjectId, authSession.profile?.username, authSession.status]);

  const refreshAuthSessionForRequest = React.useCallback(async (): Promise<string | undefined> => {
    const refreshed = await refreshAuthSession(authConfig, authSession);
    if (refreshed?.status === "authenticated" && refreshed.accessToken) {
      setAuthSession(refreshed);
      return refreshed.accessToken;
    }
    return undefined;
  }, [authConfig, authSession]);

  React.useEffect(() => {
    if (!isOidcEnabled(authConfig) || authSession.status !== "authenticated" || !authSubjectId) {
      return;
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== authSessionStorageKey || (event.storageArea && event.storageArea !== window.localStorage)) {
        return;
      }
      const nextSubjectId = subjectIdFromStoredAuthValue(event.newValue);
      if (nextSubjectId === authSubjectId) {
        return;
      }
      recordAuthDiagnosticEvent("storage_changed", {
        detail: nextSubjectId ? "Účet byl změněn v jiném okně." : "Účet byl odhlášen v jiném okně.",
        storage: "localStorage",
        subjectId: nextSubjectId
      });
      setAuthDiagnostics(readAuthDiagnostics());
      setAuthSession({
        error: nextSubjectId ? "Účet byl změněn v jiném okně." : "Účet byl odhlášen v jiném okně.",
        status: "anonymous"
      });
      setAccountChangeNotice({
        kind: nextSubjectId ? "changed" : "cleared"
      });
      try {
        window.sessionStorage.removeItem(authSessionStorageKey);
      } catch {
        // Session storage is best-effort; the important protection is dropping the active in-memory token.
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [authConfig, authSession.status, authSubjectId]);

  React.useEffect(() => {
    if (authSession.status !== "authenticated" || !authSession.expiresAt || !isOidcEnabled(authConfig)) {
      return;
    }
    const refreshDelayMs = plannedAuthRefreshDelayMs(authSession.expiresAt, Date.now(), authRefreshRetry);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      refreshAuthSession(authConfig, authSession)
        .then((nextSession) => {
          if (cancelled) {
            return;
          }
          if (nextSession?.status === "authenticated") {
            setAuthRefreshRetry(0);
            setAuthSession(nextSession);
            setAuthDiagnostics(readAuthDiagnostics());
            return;
          }
          if (shouldExpireAuthSessionAfterRefreshFailure(authSession.expiresAt)) {
            recordAuthDiagnosticEvent("session_expired", {
              detail: "Obnova přihlášení se nezdařila před expirací tokenu.",
              expiresAt: authSession.expiresAt,
              hasRefreshToken: Boolean(authSession.refreshToken),
              status: authSession.status,
              subjectId: authSubjectId,
              username: authSession.profile?.username
            });
            setAuthSession({
              error: "Přihlášení vypršelo. Přihlaste se znovu.",
              status: "anonymous"
            });
            setAuthDiagnostics(readAuthDiagnostics());
            return;
          }
          setAuthRefreshRetry((current) => current + 1);
          setAuthSession((current) => current.status === "authenticated"
            ? { ...current, error: "Obnova přihlášení se dočasně nepodařila, zkusím to znovu." }
            : current);
          setAuthDiagnostics(readAuthDiagnostics());
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          if (shouldExpireAuthSessionAfterRefreshFailure(authSession.expiresAt)) {
            setAuthSession({
              error: error instanceof Error ? error.message : "Přihlášení vypršelo.",
              status: "anonymous"
            });
            setAuthDiagnostics(readAuthDiagnostics());
            return;
          }
          setAuthRefreshRetry((current) => current + 1);
          setAuthSession((current) => current.status === "authenticated"
            ? { ...current, error: error instanceof Error ? error.message : "Obnova přihlášení se dočasně nepodařila, zkusím to znovu." }
            : current);
          setAuthDiagnostics(readAuthDiagnostics());
        });
    }, refreshDelayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    authConfig,
    authRefreshRetry,
    authSession.accessToken,
    authSession.expiresAt,
    authSession.profile?.username,
    authSession.refreshToken,
    authSession.status,
    authSubjectId
  ]);

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

    let cancelled = false;
    let authInFlight = false;
    let authInFlightForCallback = false;
    const authenticate = () => {
      const hasCallback = hasOidcCallbackParams();
      if (authInFlight && (!hasCallback || authInFlightForCallback)) {
        return;
      }
      authInFlight = true;
      authInFlightForCallback = hasCallback;
      setAuthSession((current) => current.status === "authenticated" && !hasCallback ? current : { ...current, status: "authenticating" });
      initializeAuth(authConfig)
        .then((nextSession) => {
          if (!cancelled) {
            setAuthRefreshRetry(0);
            setAuthSession(nextSession);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setAuthSession({
              error: error instanceof Error ? error.message : "OIDC přihlášení selhalo.",
              status: "error"
            });
          }
        })
        .finally(() => {
          authInFlight = false;
          authInFlightForCallback = false;
        });
    };
    const resumeCallbackIfNeeded = () => {
      if (hasOidcCallbackParams()) {
        authenticate();
      }
    };

    authenticate();
    window.addEventListener("pageshow", resumeCallbackIfNeeded);
    window.addEventListener("focus", resumeCallbackIfNeeded);
    window.addEventListener("popstate", resumeCallbackIfNeeded);
    window.addEventListener("visibilitychange", resumeCallbackIfNeeded);
    const callbackPoll = window.setInterval(resumeCallbackIfNeeded, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(callbackPoll);
      window.removeEventListener("pageshow", resumeCallbackIfNeeded);
      window.removeEventListener("focus", resumeCallbackIfNeeded);
      window.removeEventListener("popstate", resumeCallbackIfNeeded);
      window.removeEventListener("visibilitychange", resumeCallbackIfNeeded);
    };
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
        setLoadError(`${errorMessage}. Zobrazuji uložený náhled posledních dat (${formatSnapshotAge(snapshot)}).`);
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

  const refreshDemoScenario = React.useCallback(async () => {
    if (!authToken) {
      setDemoScenario(null);
      setDemoScenarioError(null);
      return;
    }
    setDemoScenarioBusy("loading");
    setDemoScenarioError(null);
    try {
      setDemoScenario(await fetchDemoScenarioStatus(apiBase, authToken, pocDemoScenarioId));
    } catch (error) {
      setDemoScenarioError(error instanceof Error ? error.message : "Stav PoC scénáře se nepodařilo načíst.");
    } finally {
      setDemoScenarioBusy((current) => current === "loading" ? null : current);
    }
  }, [authToken]);

  const handleSeedDemoScenario = React.useCallback(async () => {
    if (!authToken) {
      setDemoScenarioError("PoC scénář vyžaduje přihlášeného operátora.");
      return;
    }
    setDemoScenarioBusy("seeding");
    setDemoScenarioError(null);
    try {
      setDemoScenario(await seedDemoScenario(apiBase, authToken, pocDemoScenarioId));
      setCommunityRefreshNonce((current) => current + 1);
      void load();
    } catch (error) {
      setDemoScenarioError(error instanceof Error ? error.message : "PoC scénář se nepodařilo připravit.");
    } finally {
      setDemoScenarioBusy(null);
    }
  }, [authToken, load]);

  const handleResetDemoScenario = React.useCallback(async () => {
    if (!authToken) {
      setDemoScenarioError("PoC scénář vyžaduje přihlášeného operátora.");
      return;
    }
    const confirmed = window.confirm("Vyčistit PoC demo data? Smažou se demo skupiny, hlášení a zákresy pro tento scénář.");
    if (!confirmed) {
      return;
    }
    setDemoScenarioBusy("resetting");
    setDemoScenarioError(null);
    try {
      setDemoScenario(await resetDemoScenario(apiBase, authToken, pocDemoScenarioId));
      setCommunityRefreshNonce((current) => current + 1);
      void load();
    } catch (error) {
      setDemoScenarioError(error instanceof Error ? error.message : "PoC scénář se nepodařilo vyčistit.");
    } finally {
      setDemoScenarioBusy(null);
    }
  }, [authToken, load]);

  React.useEffect(() => {
    if (!settingsOpen || settingsTab !== "data" || !authToken) {
      return;
    }
    void refreshDemoScenario();
  }, [authToken, refreshDemoScenario, settingsOpen, settingsTab]);

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
    fetchMapCatalog(apiBase, authToken, { includePartner: Boolean(authToken), locale: appLanguageToLocale(language) })
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
        setSituationWarnings(sourceQualityWarnings(catalog.warnings));
        setSafetyWarnings(sourceQualityWarnings(catalog.warnings));
        setFlightWarnings(sourceQualityWarnings(catalog.warnings));
        setCommunityWarnings(sourceQualityWarnings(catalog.warnings));
        setMissionArenaWarnings(sourceQualityWarnings(catalog.warnings));
        setTakWarnings(authToken ? sourceQualityWarnings(catalog.warnings) : ["Partnerské vrstvy vyžadují přihlášení."]);
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
  }, [apiBase, authToken, dataAccessReady, initialPreferences.safetyLayerIds, initialPreferences.situationLayerIds, language]);

  const effectiveVisibleCatalogLayerIds = React.useMemo(
    () => withOutlineBoundaryLayer(visibleCatalogLayerIds, mapBasemapMode, mapCatalog),
    [mapBasemapMode, mapCatalog, visibleCatalogLayerIds]
  );
  const visibleCatalogLayerKey = visibleCatalogLayerIds.join(",");
  const effectiveVisibleCatalogLayerKey = effectiveVisibleCatalogLayerIds.join(",");
  const outlineBoundaryLayerEnabled = effectiveVisibleCatalogLayerIds.includes("public.boundary.admin") && !visibleCatalogLayerIds.includes("public.boundary.admin");
  const situationRasterRefreshSeconds = React.useMemo(
    () => selectedSituationRasterRefreshSeconds(mapCatalog, effectiveVisibleCatalogLayerIds),
    [effectiveVisibleCatalogLayerKey, mapCatalog]
  );
  const weatherRadarSelected = React.useMemo(
    () => effectiveVisibleCatalogLayerIds.some(isWeatherRadarCatalogLayerId),
    [effectiveVisibleCatalogLayerKey]
  );

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
    if (!autoRefresh || !dataAccessReady || !mapBounds || situationRasterRefreshSeconds === undefined) {
      return;
    }
    const timer = window.setInterval(() => {
      situationFeatureRequestRef.current = null;
      setSituationRasterRefreshTick((current) => current + 1);
    }, situationRasterRefreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, dataAccessReady, mapBounds, situationRasterRefreshSeconds]);

  React.useEffect(() => {
    if (!dataAccessReady || !weatherRadarSelected) {
      setWeatherRadarFrames([]);
      setWeatherRadarFrameIndex(0);
      setWeatherRadarPlaybackStatus("disabled");
      return;
    }
    let cancelled = false;
    setWeatherRadarPlaybackStatus((current) => current === "online" ? "online" : "loading");
    fetchWeatherRadarFrames(apiBase, authToken, { hours: 6, limit: 24, product: "merge1h" })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const frames = normalizeWeatherRadarFrames(response);
        setWeatherRadarFrames(frames);
        setWeatherRadarFrameIndex((current) => frames.length === 0 ? 0 : Math.min(current, frames.length - 1));
        setWeatherRadarPlaybackStatus(frames.length > 0 ? "online" : "degraded");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setWeatherRadarFrames([]);
        setWeatherRadarFrameIndex(0);
        setWeatherRadarPlaybackStatus("degraded");
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, authToken, dataAccessReady, weatherRadarFrameCatalogTick, weatherRadarSelected]);

  React.useEffect(() => {
    if (!autoRefresh || !dataAccessReady || !weatherRadarSelected) {
      return;
    }
    const timer = window.setInterval(() => {
      setWeatherRadarFrameCatalogTick((current) => current + 1);
    }, 300 * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, dataAccessReady, weatherRadarSelected]);

  React.useEffect(() => {
    const candidates = (situationFeatures?.features ?? [])
      .filter(isWeatherWebcamFeature)
      .flatMap((feature) => {
        const metadata = weatherWebcamMetadata(feature);
        const detailUrl = metadata.detailUrl;
        const key = weatherWebcamDetailCacheKey(feature);
        return detailUrl && key ? [{ detailUrl, feature, key }] : [];
      })
      .filter(({ feature, key }) => {
        const entry = weatherWebcamDetailCache[key];
        return !entry || (entry.status === "ready" && !entry.locationLabel && isGenericWeatherWebcamLabel(weatherWebcamTitle(feature)));
      })
      .slice(0, 60);
    if (candidates.length === 0) {
      return;
    }
    setWeatherWebcamDetailCache((current) => {
      let changed = false;
      const next = { ...current };
      candidates.forEach(({ key }) => {
        if (!next[key] || next[key].status === "error") {
          next[key] = { status: "loading" };
          changed = true;
        }
      });
      return changed ? next : current;
    });
    let cancelled = false;
    candidates.forEach(({ detailUrl, feature, key }) => {
      const proxyUrl = weatherCameraProxyUrl(detailUrl);
      if (!proxyUrl) {
        setWeatherWebcamDetailCache((current) => ({ ...current, [key]: { status: "error" } }));
        return;
      }
      void fetch(proxyUrl, {
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          Accept: "application/json"
        }
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((value) => {
          if (cancelled) {
            return;
          }
          const detail = normalizeWeatherWebcamDetail(value);
          setWeatherWebcamDetailCache((current) => ({
            ...current,
            [key]: {
              detail,
              locationLabel: weatherWebcamLocationLabel(feature, detail),
              status: "ready"
            }
          }));
        })
        .catch(() => {
          if (!cancelled) {
            setWeatherWebcamDetailCache((current) => ({ ...current, [key]: { status: "error" } }));
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [authToken, situationFeatures, weatherWebcamDetailCache]);

  React.useEffect(() => {
    if (!weatherRadarPlaybackEnabled || weatherRadarFrames.length < 2) {
      return;
    }
    const timer = window.setInterval(() => {
      setWeatherRadarFrameIndex((current) => (current + 1) % weatherRadarFrames.length);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [weatherRadarFrames.length, weatherRadarPlaybackEnabled]);

  React.useEffect(() => {
    if (!dataAccessReady) {
      return;
    }
    if (!mapBounds) {
      return;
    }
    if (shouldSkipSituationFeatureLoad(mapBounds, mapView?.zoom)) {
      situationFeatureRequestRef.current = null;
      setSituationFeatures(null);
      setSituationStatus("zoom");
      setSituationWarnings(["Situační kontext se načítá až po přiblížení mapy na rozumný výřez."]);
      return;
    }
    if (!mapCatalog) {
      return;
    }
    const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "sim.situation-data", effectiveVisibleCatalogLayerIds);
    if (catalogLayerIds.length === 0) {
      situationFeatureRequestRef.current = null;
      setSituationFeatures(null);
      setSituationStatus("disabled");
      setSituationWarnings([]);
      return;
    }
    const filters = buildCatalogFeatureFilters(catalogLayerIds, hasMobileCatalogSelection(catalogLayerIds) ? coverageTechnology : undefined);
    const requestKey = stableSituationRequestKey(catalogLayerIds, filters);
    const previousRequest = situationFeatureRequestRef.current;
    if (previousRequest?.key === requestKey && mapBoundsContainedBy(previousRequest.bounds, mapBounds)) {
      return;
    }
    const queryBounds = buildStableSituationQueryBounds(mapBounds);

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSituationStatus((current) => current === "online" ? "online" : "loading");
      fetchMapFeatures(apiBase, authToken, {
        bbox: queryBounds,
        filters,
        layerIds: catalogLayerIds,
        limit: 500,
      })
        .then((response) => {
          if (cancelled) {
            return;
          }
          const collection = response.situation ?? null;
          setSituationFeatures(collection);
          situationFeatureRequestRef.current = collection ? { bounds: queryBounds, key: requestKey } : null;
          setSituationWarnings(sourceQualityWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? []),
            ...(collection?.sourceHealth?.warnings ?? [])
          ]));
          setSituationStatus(collection ? situationStatusFromHealth(collection.sourceHealth?.health) : "online");
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            situationFeatureRequestRef.current = null;
            setSituationFeatures(null);
            setSituationStatus("degraded");
            setSituationWarnings([error instanceof Error ? error.message : "Situační kontext není dostupný."]);
          }
        });
    }, mapFeatureFetchDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBase, authToken, coverageTechnology, dataAccessReady, effectiveVisibleCatalogLayerIds, effectiveVisibleCatalogLayerKey, mapBounds, mapCatalog, mapView?.zoom, situationRasterRefreshTick]);

  React.useEffect(() => {
    if (!dataAccessReady) {
      return;
    }
    const catalogLayerIds = mapCatalog ? catalogLayerIdsForProviderSelection(mapCatalog, "sim.safety-data", effectiveVisibleCatalogLayerIds) : [];
    if (catalogLayerIds.length === 0) {
      setSafetyFeatures(null);
      setSafetyStatus("disabled");
      setSafetyWarnings([]);
      return;
    }
    if (!mapBounds) {
      return;
    }
    if (shouldSkipSafetyFeatureLoad(mapBounds, mapView?.zoom)) {
      setSafetyFeatures(null);
      setSafetyStatus("zoom");
      setSafetyWarnings(["Bezpečnostní vrstvy se načítají až po přiblížení na regionální výřez."]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!mapCatalog) {
        return;
      }
      setSafetyStatus((current) => current === "online" ? "online" : "loading");
      fetchMapFeatures(apiBase, authToken, {
        bbox: mapBounds,
        layerIds: catalogLayerIds,
        limit: 600
      })
        .then((response) => {
          if (cancelled) {
            return;
          }
          const collection = response.safety ?? null;
          setSafetyFeatures(collection);
          setSafetyWarnings(sourceQualityWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? []),
            ...(collection?.sourceHealth?.warnings ?? [])
          ]));
          setSafetyStatus(collection ? situationStatusFromHealth(collection.sourceHealth?.health) : "online");
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSafetyFeatures(null);
            setSafetyStatus("degraded");
            setSafetyWarnings([error instanceof Error ? error.message : "Bezpečnostní vrstvy nejsou dostupné."]);
          }
        });
    }, mapFeatureFetchDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBase, authToken, dataAccessReady, effectiveVisibleCatalogLayerIds, effectiveVisibleCatalogLayerKey, mapBounds, mapCatalog, mapView?.zoom]);

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
      const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "sim.flight-data", effectiveVisibleCatalogLayerIds);
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
          setFlightWarnings(sourceQualityWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? []),
            ...(collection?.sourceHealth?.warnings ?? [])
          ]));
          setFlightStatus(collection ? situationStatusFromHealth(collection.sourceHealth?.health) : "online");
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setFlightFeatures(null);
            setFlightStatus("degraded");
            setFlightWarnings([error instanceof Error ? error.message : "Letecké reference nejsou dostupné."]);
          }
        });
    }, mapFeatureFetchDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBase, authToken, communityRefreshNonce, dataAccessReady, effectiveVisibleCatalogLayerIds, effectiveVisibleCatalogLayerKey, mapBounds, mapCatalog, mapView?.zoom]);

  React.useEffect(() => {
    if (!authToken) {
      setTakFeatures(null);
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
      const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "sim.tak-gateway", effectiveVisibleCatalogLayerIds);
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
          setTakWarnings(sourceQualityWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? []),
            ...(collection?.sourceHealth?.warnings ?? [])
          ]));
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
  }, [apiBase, authToken, effectiveVisibleCatalogLayerIds, effectiveVisibleCatalogLayerKey, mapBounds, mapCatalog, mapView?.zoom]);

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
      const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "cop.community", effectiveVisibleCatalogLayerIds);
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
          setCommunityWarnings(sourceQualityWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? [])
          ]));
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
  }, [apiBase, authToken, dataAccessReady, effectiveVisibleCatalogLayerIds, effectiveVisibleCatalogLayerKey, mapBounds, mapCatalog, mapView?.zoom]);

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
      const catalogLayerIds = catalogLayerIdsForProviderSelection(mapCatalog, "csm.mission-arena", effectiveVisibleCatalogLayerIds);
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
          setMissionArenaWarnings(sourceQualityWarnings([
            ...response.warnings,
            ...(collection?.warnings ?? []),
            ...(collection?.sourceHealth?.warnings ?? [])
          ]));
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
  }, [apiBase, authToken, dataAccessReady, effectiveVisibleCatalogLayerIds, effectiveVisibleCatalogLayerKey, mapBounds, mapCatalog]);

  React.useEffect(() => {
    if (!dataAccessReady) {
      return;
    }
    if (!effectiveVisibleCatalogLayerIds.includes("user.sketch.drawings")) {
      setSketchDrawings([]);
      setSketchStatus("disabled");
      setSketchWarnings([]);
      setSelectedSketchDrawingId(null);
      setSketchMode("pan");
      return;
    }
    if (!mapBounds) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSketchStatus((current) => current === "online" ? "online" : "loading");
      fetchSketchDrawings(apiBase, authToken, {
        bbox: mapBounds,
        limit: 500
      })
        .then((collection) => {
          if (cancelled) {
            return;
          }
          setSketchDrawings(collection.features);
          setSketchStatus("online");
          setSketchWarnings([]);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSketchDrawings([]);
            setSketchStatus("degraded");
            setSketchWarnings([error instanceof Error ? error.message : "Zákresy nejsou dostupné."]);
          }
        });
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBase, authToken, dataAccessReady, effectiveVisibleCatalogLayerIds, effectiveVisibleCatalogLayerKey, mapBounds]);

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

  const operatingMode = React.useMemo(
    () => resolveOperatingMode({ browserOnline, health, loadError, offlineSnapshotState, streamStatus }),
    [browserOnline, health, loadError, offlineSnapshotState, streamStatus]
  );
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
  const weatherRadarCurrentFrame = weatherRadarFrames[weatherRadarFrameIndex];
  const animatedSituationFeatures = React.useMemo(
    () => applyWeatherRadarFrameToSituationFeatures(situationFeatures, weatherRadarCurrentFrame),
    [situationFeatures, weatherRadarCurrentFrame]
  );
  const enrichedSituationFeatures = React.useMemo(
    () => applyWeatherWebcamDetailsToSituationFeatures(animatedSituationFeatures, weatherWebcamDetailCache),
    [animatedSituationFeatures, weatherWebcamDetailCache]
  );
  const baseCombinedSituationFeatures = React.useMemo(
    () => mergeSituationSafetyFlightCommunityMissionAndTakFeatures(enrichedSituationFeatures, safetyFeatures, flightFeatures, communityFeatures, missionArenaFeatures, takFeatures),
    [communityFeatures, enrichedSituationFeatures, flightFeatures, missionArenaFeatures, safetyFeatures, takFeatures]
  );
  const selectedBaseSituationFeature = baseCombinedSituationFeatures?.features.find((feature) => feature.properties.featureId === selectedSituationFeatureId) ?? null;
  const mobileTowerViewshed = useMobileTowerViewshed(apiBase, authToken, selectedBaseSituationFeature, coverageTechnology);
  const selectedRadioProfile = React.useMemo(
    () => radioProfiles.find((profile) => (profile.profileId ?? profile.name) === radioProfileId) ?? radioProfiles[0] ?? fallbackRadioProfile,
    [radioProfileId, radioProfiles]
  );
  const radioInputOverlay = React.useMemo(
    () => activeWorkspace === "radio"
      ? buildRadioInputOverlay(radioMode, radioStation, radioLinkFrom, radioLinkTo, radioSearchTargets, selectedRadioProfile)
      : null,
    [activeWorkspace, radioLinkFrom, radioLinkTo, radioMode, radioSearchTargets, radioStation, selectedRadioProfile]
  );
  const combinedSituationFeatures = React.useMemo(() => {
    const withTowerViewshed = appendMobileTowerViewshedFeatures(baseCombinedSituationFeatures, mobileTowerViewshed);
    const withRadioResult = appendRadioLosFeatures(withTowerViewshed, radioOverlay);
    return appendRadioLosFeatures(withRadioResult, radioInputOverlay);
  }, [baseCombinedSituationFeatures, mobileTowerViewshed, radioInputOverlay, radioOverlay]);
  const selectedSituationFeature = combinedSituationFeatures?.features.find((feature) => feature.properties.featureId === selectedSituationFeatureId) ?? null;
  const visibleFlightLayerCount = React.useMemo(() => countVisibleFlightReferenceLayers(mapCatalog, visibleCatalogLayerIds), [mapCatalog, visibleCatalogLayerIds]);
  const visibleCommunityLayerCount = React.useMemo(() => countVisibleCommunityLayers(mapCatalog, visibleCatalogLayerIds), [mapCatalog, visibleCatalogLayerIds]);
  const visibleMissionArenaLayerCount = React.useMemo(() => countVisibleMissionArenaLayers(mapCatalog, visibleCatalogLayerIds), [mapCatalog, visibleCatalogLayerIds]);
  const visibleSketchLayerEnabled = visibleCatalogLayerIds.includes("user.sketch.drawings");
  const visibleSituationContextEnabled = visibleSituationLayerIds.length > 0
    || visibleSafetyLayerIds.length > 0
    || visibleTakLayerIds.length > 0
    || visibleFlightLayerCount > 0
    || visibleCommunityLayerCount > 0
    || visibleMissionArenaLayerCount > 0
    || visibleSketchLayerEnabled
    || outlineBoundaryLayerEnabled;
  const mapLayerLabel = React.useMemo(
    () => buildMapLayerLabel(visibleTrackLayerIds, visibleSituationLayerIds, visibleSafetyLayerIds, visibleTakLayerIds, visibleFlightLayerCount, visibleCommunityLayerCount, visibleMissionArenaLayerCount, outlineBoundaryLayerEnabled, visibleSketchLayerEnabled ? sketchDrawings.length : 0),
    [outlineBoundaryLayerEnabled, sketchDrawings.length, visibleCommunityLayerCount, visibleFlightLayerCount, visibleMissionArenaLayerCount, visibleSafetyLayerIds, visibleSituationLayerIds, visibleSketchLayerEnabled, visibleTakLayerIds, visibleTrackLayerIds]
  );
  const mapLayerDetailLabel = React.useMemo(
    () => buildCatalogLayerSummary(mapCatalog, effectiveVisibleCatalogLayerIds, catalogLayerFeatureCount, catalogLayerStatus),
    [
      communityFeatures,
      communityStatus,
      effectiveVisibleCatalogLayerIds,
      flightFeatures,
      flightStatus,
      mapCatalog,
      missionArenaFeatures,
      missionArenaStatus,
      safetyFeatures,
      safetyStatus,
      situationFeatures,
      situationStatus,
      sketchDrawings.length,
      sketchStatus,
      takFeatures,
      takStatus,
      visibleObjects
    ]
  );
  const mapEmptyMessage = React.useMemo(
    () =>
      buildMapEmptyMessage({
        loadError,
        objects: objectsForDisplay,
        replayActive,
        sources,
        visibleObjects
      }),
    [loadError, objectsForDisplay, replayActive, sources, visibleObjects]
  );
  const explicitlySelectedObject = selectedObjectId ? visibleObjects.find((object) => object.objectId === selectedObjectId) ?? null : null;
  const selectedObject = explicitlySelectedObject ?? visibleObjects[0] ?? null;
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
      fetchPlaceGeocode(apiBase, authToken, query, { language: appLanguageToGeocodeLanguage(language), limit: 5 })
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
  }, [apiBase, authToken, dataAccessReady, language, mapSearchQuery]);

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
  const publicSafetyAlertFeatures = React.useMemo(
    () => filterPublicSafetyAlertFeatures(combinedSituationFeatures?.features ?? []),
    [combinedSituationFeatures]
  );
  const alertSummary = React.useMemo(() => summarizeSafetyAlerts(publicSafetyAlertFeatures), [publicSafetyAlertFeatures]);
  const technicalAlertSummary = React.useMemo(() => summarizeTechnicalAlerts(serverAlerts), [serverAlerts]);
  const priorityAlertSummary = React.useMemo(
    () =>
      buildPriorityAlertSummary({
        alerts: serverAlerts,
        features: publicSafetyAlertFeatures,
        mapView,
        objects: visibleObjects,
        proximityAlerts,
        userLocation
      }),
    [mapView, proximityAlerts, publicSafetyAlertFeatures, serverAlerts, userLocation, visibleObjects]
  );
  const mapAlerts = React.useMemo<CopAlert[]>(() => [], []);
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
    if (settings.language !== undefined) {
      setLanguage(normalizeAppLanguage(settings.language));
    }
    if (settings.minConfidence !== undefined) {
      setMinConfidence(clamp(settings.minConfidence, 0, 1));
    }
    if ("operatorProfile" in settings && settings.operatorProfile !== undefined) {
      setOperatorProfile(settings.operatorProfile);
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
    if ("workspaceLayout" in settings && settings.workspaceLayout !== undefined) {
      setWorkspaceLayout(normalizeWorkspaceLayout(settings.workspaceLayout));
    }
    if ("workspaceSkin" in settings && settings.workspaceSkin !== undefined) {
      setWorkspaceSkin(normalizeWorkspaceSkin(settings.workspaceSkin));
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
    language,
    mapClusterEnabled,
    mapBasemapMode,
    mapView,
    minConfidence,
    operatorProfile,
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
    trackHistoryWindowSeconds,
    workspaceLayout,
    workspaceSkin
  }), [
    activeWorkspace,
    affiliationScope,
    alertRadiusKm,
    autoFit,
    autoRefresh,
    domainScope,
    includeSynthetic,
    language,
    mapBasemapMode,
    mapClusterEnabled,
    mapView,
    minConfidence,
    operatorProfile,
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
    trackHistoryWindowSeconds,
    workspaceLayout,
    workspaceSkin
  ]);

  React.useEffect(() => {
    profileHydratedRef.current = false;
    profileLoadKeyRef.current = null;
    skipNextPreferenceWriteRef.current = true;
    const scopedPreferences = readUserPreferences(userStorageScope);
    const scopedAlertPreferences = readLocalAlertPreferences(userStorageScope);
    catalogSelectionInitializedRef.current = scopedPreferences.catalogLayerIds !== undefined;
    setVisibleCatalogLayerIds(normalizeCatalogLayerIds(scopedPreferences.catalogLayerIds));
    setOperatorProfile(initialOperatorProfile(authSession, scopedPreferences.operatorProfile));
    setWorkspaceLayout(normalizeWorkspaceLayout(scopedPreferences.workspaceLayout));
    setWorkspaceSkin(normalizeWorkspaceSkin(scopedPreferences.workspaceSkin));
    skipNextAlertPreferenceWriteRef.current = true;
    setAlertPreferences(scopedAlertPreferences.alertPreferences);
    setLocalAlertPreferencesUpdatedAt(scopedAlertPreferences.updatedAt);
    applyPreferenceSettings(scopedPreferences, { focusMap: true });
    setViewProfiles(readViewProfiles(userStorageScope));
    setOfflineSnapshotState(initialOfflineSnapshotState(userStorageScope));
    setLastProfileName(null);
    setServerProfileUpdatedAt(null);
    setProfileSyncError(null);
    setProfileSyncStatus(profileAccessReady ? "loading" : "disabled");
  }, [applyPreferenceSettings, authSession, profileAccessReady, userStorageScope]);

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
        const serverAlertPreferences = normalizeAlertPreferences(profile.alertPreferences ?? {});
        const localAlertPreferences = readLocalAlertPreferences(userStorageScope);
        const localAlertPreferencesWin = shouldPreferLocalAlertPreferences(localAlertPreferences.updatedAt, profile.updatedAt);
        const nextAlertPreferences = localAlertPreferencesWin
          ? localAlertPreferences.alertPreferences
          : serverAlertPreferences;
        skipNextAlertPreferenceWriteRef.current = true;
        setAlertPreferences(nextAlertPreferences);
        if (!localAlertPreferencesWin) {
          const mirrorUpdatedAt = profile.updatedAt ?? new Date().toISOString();
          writeLocalAlertPreferences(nextAlertPreferences, userStorageScope, mirrorUpdatedAt);
          setLocalAlertPreferencesUpdatedAt(mirrorUpdatedAt);
        }
        const localPreferences = readUserPreferences(userStorageScope);
        const hydratedPreferences = mergeHydratedUserPreferences(serverPreferences, localPreferences, currentPreferences);
        const hasHydratedPreferences = Object.keys(hydratedPreferences).length > 0;
        const shouldMirrorPreferences = hasHydratedPreferences && !sameUserPreferences(hydratedPreferences, serverPreferences);
        setServerProfileUpdatedAt(profile.updatedAt);
        let savedProfile: Awaited<ReturnType<typeof saveUserProfile>> | null = null;
        if (hasHydratedPreferences) {
          writeUserPreferences(hydratedPreferences, userStorageScope);
          skipNextPreferenceWriteRef.current = true;
          applyPreferenceSettings(hydratedPreferences, { focusMap: true });
        }
        if (localAlertPreferencesWin || shouldMirrorPreferences || Object.keys(serverPreferences).length === 0) {
          savedProfile = await saveUserProfile(apiBase, authToken, {
            alertPreferences: nextAlertPreferences,
            preferences: hasHydratedPreferences ? hydratedPreferences : currentPreferences
          });
        }
        if (savedProfile && !cancelled) {
          const savedUpdatedAt = savedProfile.updatedAt ?? new Date().toISOString();
          setServerProfileUpdatedAt(savedProfile.updatedAt);
          writeLocalAlertPreferences(savedProfile.alertPreferences ?? nextAlertPreferences, userStorageScope, savedUpdatedAt);
          setLocalAlertPreferencesUpdatedAt(savedUpdatedAt);
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
    if (skipNextAlertPreferenceWriteRef.current) {
      skipNextAlertPreferenceWriteRef.current = false;
      return;
    }
    const updatedAt = new Date().toISOString();
    writeLocalAlertPreferences(alertPreferences, userStorageScope, updatedAt);
    setLocalAlertPreferencesUpdatedAt(updatedAt);
  }, [alertPreferences]);

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
          const savedUpdatedAt = profile.updatedAt ?? new Date().toISOString();
          writeLocalAlertPreferences(profile.alertPreferences ?? alertPreferences, userStorageScope, savedUpdatedAt);
          setLocalAlertPreferencesUpdatedAt(savedUpdatedAt);
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
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(MOBILE_SHEET_MEDIA_QUERY);
    const handleChange = () => setMobileSheetViewport(query.matches);
    handleChange();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handleChange);
      return () => query.removeEventListener("change", handleChange);
    }
    query.addListener(handleChange);
    return () => query.removeListener(handleChange);
  }, []);

  React.useEffect(() => {
    if (!mobileSheetViewport && mobileSheet) {
      setMobileSheet(null);
    }
  }, [mobileSheet, mobileSheetViewport]);

  React.useEffect(() => {
    if (mobileSheet === "detail" && !selectedSituationFeature && !explicitlySelectedObject) {
      setMobileSheet(null);
    }
  }, [explicitlySelectedObject, mobileSheet, selectedSituationFeature]);

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
        providerPreference: "auto",
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
    if (editingZoneId === ruleId) {
      setEditingZoneId(null);
    }
    setAlertPreferences((current) => ({
      ...current,
      aoiRules: (current.aoiRules ?? []).filter((rule) => rule.id !== ruleId)
    }));
  }

  function handleCreateAoiRuleFromMap() {
    setEditingZoneId(null);
    const center: [number, number] = mapView?.center ?? [defaultAoiCenter.lon, defaultAoiCenter.lat];
    createAoiRule({ lat: center[1], lon: center[0] });
  }

  function handleCreateAoiRuleFromUserLocation() {
    setEditingZoneId(null);
    if (!userLocation) {
      locateUser();
      return;
    }
    createAoiRule({ lat: userLocation.lat, lon: userLocation.lon });
  }

  function handleCreateAoiRuleFromPolygon(points: Array<{ lat: number; lon: number }>) {
    setEditingZoneId(null);
    createAoiRuleFromPolygon(points);
    setZoneCreationMode(false);
  }

  function handleStartAoiRuleEdit(ruleId: string) {
    setZoneCreationMode(false);
    setEditingZoneId((current) => (current === ruleId ? null : ruleId));
  }

  function handleAoiRulePolygonUpdate(ruleId: string, points: Array<{ lat: number; lon: number }>) {
    const polygon = createAoiPolygonFromPoints(points);
    if (!polygon) {
      return;
    }
    const center = calculateAoiPolygonCenter(polygon);
    const radiusKm = calculateAoiPolygonRadiusKm(center, polygon);
    updateAoiRule(ruleId, (rule) => ({
      ...rule,
      affiliationScope: "all",
      enabled: true,
      lat: center.lat,
      lon: center.lon,
      polygon,
      radiusKm,
      severity: "warning"
    }));
  }

  function enableUserZoneLayer() {
    if (!visibleCatalogLayerIds.includes("user.zone.alerts")) {
      applyCatalogLayerSelection(toggleCatalogLayerId(visibleCatalogLayerIds, "user.zone.alerts", true));
    }
  }

  function enableSketchLayer() {
    if (!visibleCatalogLayerIds.includes("user.sketch.drawings")) {
      applyCatalogLayerSelection(toggleCatalogLayerId(visibleCatalogLayerIds, "user.sketch.drawings", true));
    }
  }

  function requireSketchWriteToken(): string | null {
    if (authSession.accessToken && authenticatedSessionActive) {
      return authSession.accessToken;
    }
    setLoginPromptReason("profile");
    setSketchWarnings(["Pro uložení a úpravu zákresů se přihlaste."]);
    return null;
  }

  async function handleCreateSketchDrawing(input: CreateSketchDrawingRequest) {
    const token = requireSketchWriteToken();
    if (!token) {
      return;
    }
    enableSketchLayer();
    const payload: SketchDrawingPayload & { geometry: CreateSketchDrawingRequest["geometry"]; kind: CreateSketchDrawingRequest["kind"]; visibility: NonNullable<CreateSketchDrawingRequest["visibility"]> } = {
      geometry: input.geometry,
      kind: input.kind,
      label: input.label,
      properties: input.properties,
      style: input.style,
      symbol: input.symbol,
      visibility: input.visibility ?? "private"
    };
    try {
      const drawing = await createSketchDrawing(apiBase, token, payload);
      setSketchDrawings((current) => [drawing, ...current.filter((candidate) => candidate.id !== drawing.id)]);
      setSelectedSketchDrawingId(drawing.id);
      setSketchMode("select");
      setSketchStatus("online");
      setSketchWarnings([]);
    } catch (error) {
      setSketchStatus("degraded");
      setSketchWarnings([error instanceof Error ? error.message : "Zákres se nepodařilo uložit."]);
    }
  }

  async function handleUpdateSketchDrawing(drawingId: string, input: UpdateSketchDrawingRequest) {
    const token = requireSketchWriteToken();
    if (!token) {
      return;
    }
    try {
      const drawing = await updateSketchDrawing(apiBase, token, drawingId, input);
      setSketchDrawings((current) => current.map((candidate) => (candidate.id === drawing.id ? drawing : candidate)));
      setSelectedSketchDrawingId(drawing.id);
      setSketchStatus("online");
      setSketchWarnings([]);
    } catch (error) {
      setSketchStatus("degraded");
      setSketchWarnings([error instanceof Error ? error.message : "Zákres se nepodařilo upravit."]);
    }
  }

  async function handleDeleteSketchDrawing(drawingId: string) {
    const token = requireSketchWriteToken();
    if (!token) {
      return;
    }
    const drawing = sketchDrawings.find((candidate) => candidate.id === drawingId);
    const confirmed = typeof window === "undefined" || window.confirm(`Smazat zákres${drawing ? ` "${drawing.properties.label}"` : ""}?`);
    if (!confirmed) {
      return;
    }
    try {
      await deleteSketchDrawing(apiBase, token, drawingId);
      setSketchDrawings((current) => current.filter((candidate) => candidate.id !== drawingId));
      setSelectedSketchDrawingId((current) => current === drawingId ? null : current);
      setSketchWarnings([]);
    } catch (error) {
      setSketchStatus("degraded");
      setSketchWarnings([error instanceof Error ? error.message : "Zákres se nepodařilo smazat."]);
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
    if (layer.query.providerId === "cop.sketch") {
      return sketchDrawings.length;
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
    if (layer.query.providerId === "cop.sketch") {
      return sketchStatus;
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

  function loginOperator(options?: { promptLogin?: boolean }) {
    void beginLogin(authConfig, options?.promptLogin ? { prompt: "login" } : {});
  }

  function loginDifferentOperator() {
    loginOperator({ promptLogin: true });
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

  function switchToChangedAccount() {
    setAccountChangeNotice(null);
    setAuthSession((current) => ({ ...current, status: "authenticating" }));
    initializeAuth(authConfig)
      .then((nextSession) => {
        setAuthRefreshRetry(0);
        setAuthSession(nextSession);
      })
      .catch((error: unknown) => {
        setAuthSession({
          error: error instanceof Error ? error.message : "Přepnutí účtu selhalo.",
          status: "anonymous"
        });
      });
  }

  function staySignedOutAfterAccountChange() {
    try {
      window.sessionStorage.removeItem(authSessionStorageKey);
    } catch {
      // Session storage may be unavailable in restricted browser modes.
    }
    setAccountChangeNotice(null);
    setAuthRefreshRetry(0);
    setAuthSession({ status: "anonymous" });
  }

  function startCommunityReportCapture() {
    if (!profileAccessReady) {
      setProfileSyncError("Vlastní hlášení s polohou a přílohami je dostupné po přihlášení.");
      openLoginPrompt("report");
      return;
    }
    setCommunityReportDraft(createCommunityReportDraft(resolveCommunityReportLocation(null, mapView)));
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
    let linkedGroup: CommunityGroup | null = null;
    let reportCreated = false;
    let chatLinkMetadataWarning = false;
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
      const reportPayload = {
        category: communityReportDraft.category,
        description: communityReportDraft.description.trim() || undefined,
        ...(communityReportDraft.groupId ? { groupId: communityReportDraft.groupId } : {}),
        ...(communityReportDraft.groupName ? { groupName: communityReportDraft.groupName } : {}),
        hazardSeverity: communityReportDraft.hazardSeverity,
        location: communityReportDraft.location,
        observedAt: new Date().toISOString(),
        title: communityReportDraft.title.trim(),
        validUntil: communityReportDraft.validUntil ? new Date(communityReportDraft.validUntil).toISOString() : undefined,
        visibility: "community"
      } as const;
      linkedGroup = communityReportDraft.reportId
        ? null
        : await createCommunityReportChatGroup(authToken, communityReportDraft);
      const report = communityReportDraft.reportId
        ? await updateCommunityReport(apiBase, authToken, communityReportDraft.reportId, reportPayload)
        : await createCommunityReport(apiBase, authToken, {
          ...reportPayload,
          ...(linkedGroup ? { groupId: linkedGroup.groupId, groupName: linkedGroup.name } : {})
        });
      reportCreated = true;
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
          metadata: buildCommunityAttachmentMetadata(file, contentType, kind, communityReportDraft.videoSpatialMode, communityReportAccessPolicy(communityReportDraft))
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
      if (linkedGroup) {
        try {
          await persistCommunityReportChatGroupLink(authToken, linkedGroup, submitted);
        } catch {
          chatLinkMetadataWarning = true;
        }
      }
      setCommunityReportDraft(createCommunityReportDraft(resolveCommunityReportLocation(null, mapView)));
      setCommunityReportSuccess(communityReportDraft.reportId ? "Hlášení bylo upraveno." : "Hlášení bylo uloženo.");
      setCommunityReportOpen(false);
      setCommunityReportLocationPickMode(false);
      setCommunityRefreshNonce((current) => current + 1);
      setSelectedSituationFeatureId(`community:${submitted.reportId}`);
      setSelectedObjectId(null);
      if (linkedGroup) {
        requestEmbeddedChatSelection(linkedGroup.groupId);
      }
      enableCommunityReportCatalogLayers();
      setLocationStatus(chatLinkMetadataWarning
        ? "Hlášení bylo uloženo. Chatová skupina vznikla, ale metadata vazby se nepodařilo doplnit."
        : "Hlášení bylo uloženo.");
    } catch (error) {
      if (linkedGroup && !reportCreated) {
        try {
          await deleteCommunityGroup(apiBase, authToken, linkedGroup.groupId);
        } catch {
          // Best effort cleanup only; keep the original report error visible to the user.
        }
      }
      setCommunityReportError(error instanceof Error ? error.message : "Hlášení se nepodařilo uložit.");
    } finally {
      setCommunityReportSubmitting(false);
      setCommunityUploadProgress(null);
    }
  }

  function requestEmbeddedChatSelection(selectionId: string) {
    messagingSelectionNonceRef.current += 1;
    setMessagingSelection({
      id: selectionId,
      nonce: messagingSelectionNonceRef.current
    });
  }

  async function createCommunityReportChatGroup(token: string, draft: CommunityReportDraft): Promise<CommunityGroup> {
    const groupName = communityReportChatGroupName(draft.title);
    return createCommunityGroup(apiBase, token, {
      anchorLocation: draft.location,
      description: communityReportChatGroupDescription(draft),
      metadata: {
        createdFrom: "cop-community-report",
        hazardSeverity: draft.hazardSeverity,
        reportCategory: draft.category,
        source: "cop.map",
        status: "pending-report"
      },
      name: groupName,
      visibility: "public"
    });
  }

  async function persistCommunityReportChatGroupLink(token: string, group: CommunityGroup, report: CommunityReport): Promise<void> {
    await updateCommunityGroupMetadata(apiBase, token, group.groupId, {
      createdFrom: "cop-community-report",
      featureId: `community:${report.reportId}`,
      hazardSeverity: typeof report.properties.hazardSeverity === "string" ? report.properties.hazardSeverity : null,
      reportCategory: report.category,
      reportId: report.reportId,
      reportTitle: report.title,
      source: "cop.map",
      status: "linked-report"
    });
  }

  function openCommunityReportChat(feature: SituationFeature) {
    const properties = feature.properties;
    const groupId = typeof properties.groupId === "string" ? properties.groupId : undefined;
    if (!groupId) {
      setLocationStatus("Toto hlášení nemá navázanou chatovou skupinu.");
      return;
    }
    requestEmbeddedChatSelection(groupId);
    setMessagingOpen(true);
    setMessagingPinned(true);
    setMobileSheet(null);
    setLocationStatus("Otevírám chat k vybrané události.");
  }

  function editCommunityReportFeature(feature: SituationFeature) {
    const properties = feature.properties;
    if (properties.layer !== "community" || !properties.reportId) {
      return;
    }
    const coordinates = feature.geometry.type === "Point" ? feature.geometry.coordinates : null;
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
      groupId: typeof properties.groupId === "string" ? properties.groupId : undefined,
      groupName: typeof properties.groupName === "string" ? properties.groupName : undefined,
      hazardSeverity: severity,
      mediaAccessMode: "public",
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
    setAuthRefreshRetry(0);
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
        trackHistoryWindowSeconds,
        workspaceLayout,
        workspaceSkin
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
  const showRadioControls = activeWorkspace === "radio";
  const openIncidentTaskStatuses = React.useMemo<IncidentTaskStatus[]>(() => ["open", "in_progress", "blocked"], []);

  const radioRequestBase = React.useCallback(() => radioUseCustomProfile
    ? { profile: radioCustomProfile }
    : { profileId: selectedRadioProfile.profileId ?? radioProfileId },
    [radioCustomProfile, radioProfileId, radioUseCustomProfile, selectedRadioProfile]
  );
  const radioReferencePoint = React.useCallback((): RadioPoint => {
    if (userLocation) {
      return { antennaHeightM: selectedRadioProfile.antennaHeightM, lat: userLocation.lat, lon: userLocation.lon, receiverHeightM: selectedRadioProfile.receiverHeightM };
    }
    const center = mapView?.center ?? [(mapBounds.west + mapBounds.east) / 2, (mapBounds.south + mapBounds.north) / 2];
    return { antennaHeightM: selectedRadioProfile.antennaHeightM, lat: center[1], lon: center[0], receiverHeightM: selectedRadioProfile.receiverHeightM };
  }, [mapBounds, mapView?.center, selectedRadioProfile, userLocation]);

  const resetRadioComputation = React.useCallback((mode = radioMode) => {
    setRadioOverlay(null);
    setRadioResult({ mode, status: "idle", title: "Radio LoS", warnings: [] });
  }, [radioMode]);

  const applyRadioPointToTarget = React.useCallback((target: RadioPointPickTarget, point: RadioPoint) => {
    if (target === "station") {
      setRadioStation(point);
    } else if (target === "from") {
      setRadioLinkFrom(point);
    } else if (target === "to") {
      setRadioLinkTo(point);
    } else {
      setRadioSearchTargets([point]);
    }
    resetRadioComputation();
  }, [resetRadioComputation]);

  const loadRadioProfiles = React.useCallback(async () => {
    setRadioProfilesStatus("loading");
    setRadioProfilesError(null);
    try {
      const response: RadioProfilesResponse = await fetchRadioProfiles(apiBase, authToken);
      const profiles = response.profiles.length > 0 ? response.profiles : defaultRadioProfiles;
      setRadioProfiles(profiles);
      setRadioProfileId((current) => profiles.some((profile) => (profile.profileId ?? profile.name) === current) ? current : profiles[0]?.profileId ?? profiles[0]?.name ?? current);
      setRadioProfilesStatus("loaded");
    } catch (error) {
      setRadioProfiles(defaultRadioProfiles);
      setRadioProfilesError(error instanceof Error ? humanizeApiError(error.message) : "Katalog rádiových profilů není dostupný, používám lokální výchozí šablony.");
      setRadioProfilesStatus("error");
    }
  }, [apiBase, authToken]);

  React.useEffect(() => {
    if (!showRadioControls || radioProfilesStatus !== "idle") {
      return;
    }
    void loadRadioProfiles();
  }, [loadRadioProfiles, radioProfilesStatus, showRadioControls]);

  const applyRadioPointFromContext = React.useCallback((target: RadioPointPickTarget) => {
    applyRadioPointToTarget(target, radioReferencePoint());
    setRadioPointPickTarget(null);
  }, [applyRadioPointToTarget, radioReferencePoint]);

  const startRadioPointPick = React.useCallback((target: RadioPointPickTarget) => {
    setActiveWorkspace("radio");
    setMobileSheet(null);
    setMobileSketchOpen(false);
    setCommunityReportLocationPickMode(false);
    setZoneCreationMode(false);
    setRadioPointPickTarget((current) => current === target ? null : target);
  }, []);

  const handleRadioPointPicked = React.useCallback((center: { lat: number; lon: number }) => {
    if (!radioPointPickTarget) {
      return;
    }
    const currentPoint = radioPointForTarget(radioPointPickTarget, radioStation, radioLinkFrom, radioLinkTo, radioSearchTargets);
    applyRadioPointToTarget(radioPointPickTarget, radioPointFromMapClick(currentPoint, center));
    setRadioPointPickTarget(null);
  }, [applyRadioPointToTarget, radioLinkFrom, radioLinkTo, radioPointPickTarget, radioSearchTargets, radioStation]);

  const updateRadioMode = React.useCallback((mode: RadioLosMode) => {
    setRadioMode(mode);
    setRadioPointPickTarget(null);
    resetRadioComputation(mode);
  }, [resetRadioComputation]);

  const updateRadioStation = React.useCallback((point: RadioPoint) => {
    setRadioStation(point);
    resetRadioComputation();
  }, [resetRadioComputation]);

  const updateRadioLinkFrom = React.useCallback((point: RadioPoint) => {
    setRadioLinkFrom(point);
    resetRadioComputation();
  }, [resetRadioComputation]);

  const updateRadioLinkTo = React.useCallback((point: RadioPoint) => {
    setRadioLinkTo(point);
    resetRadioComputation();
  }, [resetRadioComputation]);

  const updateRadioSearchTargets = React.useCallback((targets: RadioPoint[]) => {
    setRadioSearchTargets(targets);
    resetRadioComputation();
  }, [resetRadioComputation]);

  const saveCustomRadioProfile = React.useCallback(async () => {
    setRadioProfilesStatus("loading");
    setRadioProfilesError(null);
    try {
      const response = await createRadioProfile(apiBase, authToken, radioCustomProfile);
      const profiles = response.profiles.length > 0 ? response.profiles : [radioCustomProfile, ...defaultRadioProfiles];
      setRadioProfiles(profiles);
      setRadioProfileId(profiles[0]?.profileId ?? radioCustomProfile.profileId ?? radioProfileId);
      setRadioUseCustomProfile(false);
      setRadioProfilesStatus("loaded");
    } catch (error) {
      setRadioProfilesError(error instanceof Error ? humanizeApiError(error.message) : "Vlastní profil se nepodařilo uložit.");
      setRadioProfilesStatus("error");
    }
  }, [apiBase, authToken, radioCustomProfile, radioProfileId]);

  const runRadioLos = React.useCallback(async () => {
    const base = radioRequestBase();
    setRadioResult({ mode: radioMode, status: "loading", title: radioLosModeLabel(radioMode), warnings: [] });
    try {
      if (radioMode === "coverage") {
        const request: RadioCoverageRequest = {
          ...base,
          azimuthStepDeg: 5,
          distanceStepM: 250,
          radioName: selectedRadioProfile.name,
          radiusM: radioRadiusM,
          station: radioStation
        };
        const response = await runRadioCoverage(apiBase, authToken, request);
        const features = radioFeatureCollectionToSituationFeatures(response, radioMode, selectedRadioProfile);
        setRadioOverlay({ features, mode: radioMode, title: "Pokrytí z bodu", warnings: response.warnings });
        setRadioResult({ collection: response, mode: radioMode, status: "loaded", title: "Pokrytí z bodu", warnings: response.warnings });
        return;
      }
      if (radioMode === "site") {
        const request: RadioSiteSearchRequest = {
          ...base,
          gridStepM: radioGridStepM,
          maxCandidates: 20,
          radioName: selectedRadioProfile.name,
          searchArea: { bbox: [mapBounds.west, mapBounds.south, mapBounds.east, mapBounds.north] },
          targets: radioSearchTargets
        };
        const response = await runRadioSiteSearch(apiBase, authToken, request);
        const features = radioFeatureCollectionToSituationFeatures(response, radioMode, selectedRadioProfile);
        setRadioOverlay({ features, mode: radioMode, title: "Kandidátní stanoviště", warnings: response.warnings });
        setRadioResult({ collection: response, mode: radioMode, status: "loaded", title: "Kandidátní stanoviště", warnings: response.warnings });
        return;
      }
      const request: RadioLinkCheckRequest = {
        ...base,
        from: radioLinkFrom,
        radioName: selectedRadioProfile.name,
        to: radioLinkTo
      };
      const response = await runRadioLinkCheck(apiBase, authToken, request);
      const linkFeature = radioLinkCheckToSituationFeature(response, request, selectedRadioProfile);
      setRadioOverlay({ features: [linkFeature], mode: radioMode, title: "Spojení bod-bod", warnings: response.warnings });
      setRadioResult({ link: response, mode: radioMode, status: "loaded", title: "Spojení bod-bod", warnings: response.warnings });
    } catch (error) {
      const message = error instanceof Error ? humanizeApiError(error.message) : "Radio LoS výpočet selhal.";
      setRadioOverlay(null);
      setRadioResult({ error: message, mode: radioMode, status: "error", title: radioLosModeLabel(radioMode), warnings: [] });
    }
  }, [
    apiBase,
    authToken,
    mapBounds,
    radioGridStepM,
    radioLinkFrom,
    radioLinkTo,
    radioMode,
    radioRadiusM,
    radioRequestBase,
    radioSearchTargets,
    radioStation,
    selectedRadioProfile
  ]);

  const loadIncidentTasks = React.useCallback(async (incidentId: string, token = authToken) => {
    if (!token) {
      return;
    }
    const response = await fetchIncidentTasks(apiBase, token, incidentId, {
      limit: 20,
      statuses: openIncidentTaskStatuses
    });
    setIncidentTasksById((current) => ({
      ...current,
      [incidentId]: response.items
    }));
  }, [apiBase, authToken, openIncidentTaskStatuses]);

  const loadIncidentWorkflow = React.useCallback(async () => {
    if (!authToken) {
      setIncidentSuggestions([]);
      setIncidents([]);
      setIncidentTasksById({});
      setSelectedIncidentId(null);
      setIncidentWorkflowError(null);
      setIncidentWorkflowStatus("Incidentní workflow je dostupné po přihlášení operátora.");
      return;
    }

    setIncidentWorkflowLoading(true);
    setIncidentWorkflowError(null);
    try {
      const [suggestionResponse, incidentResponse] = await Promise.all([
        fetchIncidentFusionSuggestions(apiBase, authToken, {
          bbox: mapBounds,
          includeSingletons: true,
          limit: 8,
          radiusM: 1200,
          timeWindowSeconds: 7200
        }),
        fetchIncidents(apiBase, authToken, {
          bbox: mapBounds,
          limit: 20,
          statuses: ["active", "candidate", "monitoring"]
        })
      ]);
      const nextIncidents = incidentResponse.items;
      const nextSelectedIncidentId = selectedIncidentId && nextIncidents.some((incident) => incident.incidentId === selectedIncidentId)
        ? selectedIncidentId
        : nextIncidents[0]?.incidentId ?? null;

      setIncidentSuggestions(suggestionResponse.items);
      setIncidents(nextIncidents);
      setSelectedIncidentId(nextSelectedIncidentId);
      setIncidentWorkflowStatus(`Načteno ${nextIncidents.length} incidentů a ${suggestionResponse.items.length} návrhů.`);

      const taskIncidentIds = [...new Set([
        nextSelectedIncidentId,
        ...nextIncidents.slice(0, 2).map((incident) => incident.incidentId)
      ].filter((incidentId): incidentId is string => Boolean(incidentId)))];
      const taskPairs = await Promise.all(taskIncidentIds.map(async (incidentId) => {
        const response = await fetchIncidentTasks(apiBase, authToken, incidentId, {
          limit: 20,
          statuses: openIncidentTaskStatuses
        });
        return [incidentId, response.items] as const;
      }));
      setIncidentTasksById((current) => ({
        ...current,
        ...Object.fromEntries(taskPairs)
      }));
    } catch (error) {
      setIncidentWorkflowError(error instanceof Error ? error.message : "Incidentní workflow není dostupné.");
    } finally {
      setIncidentWorkflowLoading(false);
    }
  }, [apiBase, authToken, mapBounds, openIncidentTaskStatuses, selectedIncidentId]);

  React.useEffect(() => {
    if (!showAlertControls) {
      return;
    }
    void loadIncidentWorkflow();
  }, [loadIncidentWorkflow, showAlertControls]);

  const handleSelectIncident = React.useCallback((incidentId: string) => {
    setSelectedIncidentId(incidentId);
    setIncidentTaskDraft("");
    void loadIncidentTasks(incidentId);
  }, [loadIncidentTasks]);

  const handleAcceptIncidentSuggestion = React.useCallback(async (suggestion: IncidentFusionSuggestion) => {
    if (!authToken) {
      setIncidentWorkflowError("Přijetí návrhu vyžaduje přihlášení.");
      return;
    }
    setIncidentWorkflowLoading(true);
    setIncidentWorkflowError(null);
    try {
      const incident = await createIncident(apiBase, authToken, {
        category: suggestion.category,
        confidence: suggestion.confidence,
        description: suggestion.description ?? suggestion.explanation,
        location: {
          ...suggestion.location,
          source: "fusion"
        },
        properties: {
          ...suggestion.properties,
          fusionSuggestionId: suggestion.suggestionId,
          reportIds: suggestion.reportIds
        },
        provenance: [{
          explanation: suggestion.explanation,
          kind: "fusion_suggestion",
          metrics: suggestion.metrics,
          suggestionId: suggestion.suggestionId
        }],
        severity: suggestion.severity,
        sourceRefs: suggestion.sourceRefs,
        status: "active",
        title: suggestion.title
      });
      setIncidents((current) => [incident, ...current.filter((candidate) => candidate.incidentId !== incident.incidentId)]);
      setIncidentSuggestions((current) => current.filter((candidate) => candidate.suggestionId !== suggestion.suggestionId));
      setSelectedIncidentId(incident.incidentId);
      setIncidentWorkflowStatus("Návrh byl převeden na aktivní incident.");
      void loadIncidentTasks(incident.incidentId, authToken);
    } catch (error) {
      setIncidentWorkflowError(error instanceof Error ? error.message : "Návrh se nepodařilo přijmout.");
    } finally {
      setIncidentWorkflowLoading(false);
    }
  }, [apiBase, authToken, loadIncidentTasks]);

  const handleUpdateIncidentStatus = React.useCallback(async (incidentId: string, status: IncidentStatus) => {
    if (!authToken) {
      setIncidentWorkflowError("Změna incidentu vyžaduje přihlášení.");
      return;
    }
    setIncidentWorkflowError(null);
    try {
      const incident = await updateIncident(apiBase, authToken, incidentId, { status });
      setIncidents((current) => current.map((candidate) => candidate.incidentId === incident.incidentId ? incident : candidate));
      setIncidentWorkflowStatus(`Incident je nyní ${incidentStatusLabel(status).toLowerCase()}.`);
    } catch (error) {
      setIncidentWorkflowError(error instanceof Error ? error.message : "Incident se nepodařilo aktualizovat.");
    }
  }, [apiBase, authToken]);

  const handleCreateIncidentTask = React.useCallback(async (incidentId: string, title: string) => {
    if (!authToken) {
      setIncidentWorkflowError("Založení úkolu vyžaduje přihlášení.");
      return;
    }
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }
    setIncidentWorkflowError(null);
    try {
      const task = await createIncidentTask(apiBase, authToken, incidentId, {
        priority: "normal",
        status: "open",
        title: normalizedTitle
      });
      setIncidentTasksById((current) => ({
        ...current,
        [incidentId]: [task, ...(current[incidentId] ?? [])]
      }));
      setIncidentTaskDraft("");
      setIncidentWorkflowStatus("Úkol byl založen.");
    } catch (error) {
      setIncidentWorkflowError(error instanceof Error ? error.message : "Úkol se nepodařilo založit.");
    }
  }, [apiBase, authToken]);

  const handleUpdateIncidentTaskStatus = React.useCallback(async (incidentId: string, taskId: string, status: IncidentTaskStatus) => {
    if (!authToken) {
      setIncidentWorkflowError("Změna úkolu vyžaduje přihlášení.");
      return;
    }
    setIncidentWorkflowError(null);
    try {
      const task = await updateIncidentTask(apiBase, authToken, incidentId, taskId, { status });
      setIncidentTasksById((current) => ({
        ...current,
        [incidentId]: (current[incidentId] ?? []).map((candidate) => candidate.taskId === task.taskId ? task : candidate)
      }));
      setIncidentWorkflowStatus("Úkol byl aktualizován.");
    } catch (error) {
      setIncidentWorkflowError(error instanceof Error ? error.message : "Úkol se nepodařilo aktualizovat.");
    }
  }, [apiBase, authToken]);

  const catalogGroupViews = React.useMemo(() => buildCatalogGroupViews(mapCatalog), [mapCatalog]);
  const activeCatalogGroup = catalogGroupViews.find((view) => view.group.groupId === activeCatalogGroupId) ?? null;
  const priorityAlert = priorityAlertSummary.primary;
  const operationTitle = priorityAlert?.title ?? "Bez prioritní výstrahy v okolí";
  const operationBadge = priorityAlert?.badge ?? "Klid v okolí";
  const priorityAlertAdditionalLabel = priorityAlertSummary.additionalCount > 0 ? `+${priorityAlertSummary.additionalCount} dalších` : "";
  const effectiveOperatorProfile = React.useMemo(
    () => mergeOperatorProfile(authSession, operatorProfile),
    [authSession, operatorProfile]
  );
  const shellClassName = clsx(
    "shell",
    "app-shell-v2",
    `app-skin-${workspaceSkin}`,
    isWebKitRuntime() && "webkit-runtime",
    mobileSheet && `mobile-sheet-${mobileSheet}`,
    mobileSheet && "mobile-sheet-open",
    messagingOpen && messagingPinned && "shell-messaging-docked",
    !workspaceLayout.statusbarVisible && "shell-statusbar-hidden"
  );
  const workspaceClassName = clsx(
    "workspace",
    `workspace-${activeWorkspace}`,
    `workspace-left-${workspaceLayout.leftPanelMode}`,
    `workspace-right-${workspaceLayout.rightPanelMode}`
  );
  const shellStyle = React.useMemo(() => {
    const style: React.CSSProperties = {
      "--workspace-left-width": `${workspaceLayout.leftPanelWidth}px`,
      "--workspace-right-width": `${workspaceLayout.rightPanelWidth}px`
    } as React.CSSProperties;
    if (messagingOpen && messagingPinned) {
      return {
        ...style,
        "--messaging-dock-width": `${messagingDockWidth}px`
      } as React.CSSProperties;
    }
    return style;
  }, [messagingDockWidth, messagingOpen, messagingPinned, workspaceLayout.leftPanelWidth, workspaceLayout.rightPanelWidth]);
  const mobileDetailSheetForSelection = React.useCallback((isSelected: boolean): MobileSheet =>
    isSelected || !mobileSheetViewport ? null : "detail", [mobileSheetViewport]);

  const updateWorkspaceLayout = React.useCallback((patch: Partial<WorkspaceLayoutPreferences>) => {
    setWorkspaceLayout((current) => normalizeWorkspaceLayout({ ...current, ...patch }));
  }, []);

  const applyWorkspaceTemplate = React.useCallback((templateId: WorkspaceTemplateId) => {
    const template = workspaceTemplatePreferences(templateId);
    setWorkspaceSkin(template.workspaceSkin);
    setWorkspaceLayout(normalizeWorkspaceLayout(template.workspaceLayout));
    setMapBasemapMode(template.mapBasemapMode);
    setPublicFlightSymbolMode(template.publicFlightSymbolMode);
    setMapClusterEnabled(template.mapClusterEnabled);
    setShowAlertAreas(template.showAlertAreas);
    setActiveWorkspace("map");
  }, []);

  const beginWorkspacePanelResize = React.useCallback((side: "left" | "right", event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = side === "left" ? workspaceLayout.leftPanelWidth : workspaceLayout.rightPanelWidth;
    const range = side === "left" ? workspaceLeftWidthRange : workspaceRightWidthRange;
    let pendingWidth = startWidth;
    let finalWidth = startWidth;
    let frameId: number | null = null;
    const applyWidth = () => {
      frameId = null;
      finalWidth = clamp(pendingWidth, range.min, range.max);
      shellRef.current?.style.setProperty(
        side === "left" ? "--workspace-left-width" : "--workspace-right-width",
        `${finalWidth}px`
      );
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      pendingWidth = side === "left" ? startWidth + delta : startWidth - delta;
      if (frameId === null) {
        frameId = window.requestAnimationFrame(applyWidth);
      }
    };
    const finishResize = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        applyWidth();
      }
      setWorkspaceResizeActive(false);
      updateWorkspaceLayout(side === "left" ? { leftPanelWidth: finalWidth } : { rightPanelWidth: finalWidth });
      document.documentElement.classList.remove("layout-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };
    setWorkspaceResizeActive(true);
    document.documentElement.classList.add("layout-resizing");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize, { once: true });
    window.addEventListener("pointercancel", finishResize, { once: true });
  }, [updateWorkspaceLayout, workspaceLayout.leftPanelWidth, workspaceLayout.rightPanelWidth]);

  React.useEffect(() => {
    if (activeCatalogGroupId && !catalogGroupViews.some((view) => view.group.groupId === activeCatalogGroupId)) {
      setActiveCatalogGroupId(null);
    }
  }, [activeCatalogGroupId, catalogGroupViews]);

  React.useEffect(() => {
    const firstCatalogGroupId = catalogGroupViews[0]?.group.groupId;
    if (mobileSheet === "layers" && !activeCatalogGroupId && firstCatalogGroupId) {
      setActiveCatalogGroupId(firstCatalogGroupId);
    }
  }, [activeCatalogGroupId, catalogGroupViews, mobileSheet]);

  return (
    <main
      className={shellClassName}
      ref={shellRef}
      style={shellStyle}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <img src="/icons/cop-icon.svg" alt="" />
          </div>
          <div>
            <h1>
              <span className="brand-title-full">COP / CSM</span>
              <span className="brand-title-compact">CSM</span>
            </h1>
            <p>Rizika v okolí, výstrahy a sdílené informace</p>
          </div>
        </div>
        <div className={clsx("mission-strip", "priority-alert-strip", priorityAlert?.tone ?? "ok")} aria-label="Prioritní výstraha v okolí">
          <span>{operationBadge}</span>
          <strong>{operationTitle}</strong>
          {priorityAlertAdditionalLabel ? <small>{priorityAlertAdditionalLabel}</small> : null}
        </div>
        <div className="topbar-actions">
          <button className="top-command-button record" onClick={startCommunityReportCapture} type="button">
            <span className="record-dot" />
            Záznam
          </button>
          <button
            className="top-command-button"
            onClick={() => void navigator.clipboard?.writeText(window.location.href)}
            type="button"
          >
            <Link2 size={15} />
            Kopírovat odkaz
          </button>
          <button
            className="top-command-button"
            onClick={() => {
              const url = window.location.href;
              if (navigator.share) {
                void navigator.share({ title: "Civilní situační mapa", url }).catch(() => navigator.clipboard?.writeText(url));
                return;
              }
              void navigator.clipboard?.writeText(url);
            }}
            type="button"
          >
            <MonitorUp size={15} />
            Sdílet
          </button>
          <a className="operator-button xr-entry-button" href="/xr" title="Otevřít prostorový XR režim">
            <Sparkles size={18} />
            <span>
              XR
              <strong>Quest</strong>
            </span>
          </a>
          <button
            aria-label={profileAccessReady ? "Účet - otevřít nastavení" : "Přihlásit"}
            className="operator-button account-entry-button"
            onClick={() => {
              if (profileAccessReady || !isOidcEnabled(authConfig)) {
                openSettings("account");
                return;
              }
              loginOperator({ promptLogin: true });
            }}
            title={profileAccessReady ? "Účet - otevřít nastavení" : "Přihlásit"}
            type="button"
          >
            <OperatorAvatar profile={effectiveOperatorProfile} size="small" />
            {!profileAccessReady && isOidcEnabled(authConfig) ? (
              <span>
                <strong>Přihlásit</strong>
              </span>
            ) : (
              <>
                <span>
                  Operátor
                  <strong>{operatorDisplayName(authSession, authConfig, effectiveOperatorProfile)}</strong>
                </span>
                <ChevronDown size={15} />
              </>
            )}
          </button>
          <button className="operator-button help-entry-button" onClick={() => setHelpSection("overview")} title="Otevřít manuál" type="button">
            <BookOpen size={18} />
            <span>
              Manuál
              <strong>Nápověda</strong>
            </span>
          </button>
        </div>
      </header>

      <section className="app-shell-body">
        <WorkspaceNavigator
          activeWorkspace={activeWorkspace}
          chatUnreadCount={messagingUnreadCount}
          onChange={setActiveWorkspace}
          onOpenMessaging={() => {
            setMessagingOpen(true);
            setMessagingPinned(true);
          }}
          onOpenSettings={() => openSettings("map")}
          onStartReport={startCommunityReportCapture}
        />

      <section className={workspaceClassName}>
        {workspaceLayout.leftPanelMode !== "hidden" ? (
        <aside className={`panel left-panel ${showMapLayerControls ? "map-catalog-panel" : ""}`}>
          {workspaceLayout.leftPanelMode === "collapsed" ? (
            <CollapsedPanelRail
              icon={<Layers size={18} />}
              label={showMapLayerControls ? "Vrstvy" : workspace.label}
              onExpand={() => updateWorkspaceLayout({ leftPanelMode: "open" })}
            />
          ) : (
            <>
          <MobileSheetPullHandle label="Stáhnout panel vrstev" onClose={() => setMobileSheet(null)} />
          {!showMapLayerControls ? (
            <>
              <div className="refresh-row compact">
                <span>Poslední aktualizace</span>
                <strong>{lastLoadedAt ?? "čekám na data"}</strong>
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
              onCloseDrawer={() => {
                if (mobileSheet === "layers") {
                  setMobileSheet(null);
                }
                setActiveCatalogGroupId(null);
              }}
              onGroupSelect={(groupId) => setActiveCatalogGroupId((current) => mobileSheet === "layers" ? groupId : current === groupId ? null : groupId)}
              getFeatureCount={catalogLayerFeatureCount}
              getLayerStatus={catalogLayerStatus}
              isLayerEnabled={isCatalogLayerEnabled}
              isLayerOperable={isCatalogLayerOperable}
              onToggleLayer={toggleCatalogLayer}
              coverageTechnology={coverageTechnology}
              onCoverageTechnologyChange={setCoverageTechnology}
              userZones={aoiRules}
              zoneCreationMode={zoneCreationMode}
              editingZoneId={editingZoneId}
              onUserZoneColorChange={handleAoiRuleColorChange}
              onUserZoneCreateFromMap={handleCreateAoiRuleFromMap}
              onUserZoneCreateFromUserLocation={handleCreateAoiRuleFromUserLocation}
              onUserZoneDelete={handleAoiRuleDelete}
              onUserZoneEnabledChange={handleAoiRuleEnabledChange}
              onUserZoneEdit={handleStartAoiRuleEdit}
              onUserZoneRadiusChange={handleAoiRuleRadiusChange}
              onUserZoneStartDrawing={() => {
                setEditingZoneId(null);
                setZoneCreationMode((current) => !current);
              }}
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
                onSave={saveCurrentViewProfile}
              />

              <div className="mission-metrics">
                <MetricTile label="Vlastní" value={metrics.friendlyCount} tone="friend" />
                <MetricTile label="Rizikové" value={metrics.foreignCount} tone="hostile" />
                <MetricTile label="Jistota" value={`${metrics.avgConfidence}%`} tone={metrics.avgConfidence >= 75 ? "ok" : "warn"} />
                <MetricTile label="Výstrahy" value={alertSummary.total} tone={alertSummary.total > 0 ? "warn" : "ok"} />
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
                  Minimální jistota dat
                  <input type="range" min="0" max="1" step="0.05" value={minConfidence} onChange={(event) => setMinConfidence(Number(event.target.value))} />
                  <span>{Math.round(minConfidence * 100)} %</span>
                </label>
                <SegmentedControl
                  label="Vztah"
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
                  label="Doména"
                  options={[
                    ["all", "Vše"],
                    ["AIR", "Vzduch"],
                    ["LAND", "Země"],
                    ["RESCUE", "Záchrana"]
                  ]}
                  value={domainScope}
                  onChange={(value) => setDomainScope(value as DomainScope)}
                />
              </div>
            </>
          ) : null}

          {showAlertControls ? (
            <div className="workspace-module-card">
              <PanelTitle icon={<AlertTriangle size={17} />} title="Výstrahy" />
              <ReadinessRow label="SIM safety výstrahy" value={String(alertSummary.total)} tone={alertSummary.total > 0 ? "warn" : "ok"} />
              <ReadinessRow label="Kritické" value={String(alertSummary.critical)} tone={alertSummary.critical > 0 ? "warn" : "ok"} />
              <ReadinessRow label="Varování" value={String(alertSummary.warning)} tone={alertSummary.warning > 0 ? "warn" : "ok"} />
              <ReadinessRow label="Zapnuté vrstvy" value={visibleSafetyLayerIds.length > 0 ? String(visibleSafetyLayerIds.length) : "vypnuto"} tone={visibleSafetyLayerIds.length > 0 ? "ok" : "neutral"} />
              <ReadinessRow label="Stav zdroje" value={formatSafetyReadiness(safetyStatus, safetyFeatures)} tone={situationStatusTone(safetyStatus)} />
              <button className="mini-button wide" onClick={() => void load()} type="button">
                <RefreshCw size={14} />
                Obnovit safety data
              </button>
              <button className="mini-button wide" onClick={() => openSettings("awareness")} type="button">
                <Settings size={14} />
                Nastavení výstrah
              </button>
            </div>
          ) : null}

          {showReplayControls ? (
            <div className="workspace-module-card">
              <PanelTitle icon={<History size={17} />} title="Zpětné přehrání" />
              <ReadinessRow label="Stav" value={formatReplayStatus(replayTimestamp, replayWindow, replayActive)} tone={replayActive ? "warn" : "neutral"} />
              <ReadinessRow label="Historie" value={`${trackHistoryWindowSeconds} s / ${historyPointCount} bodů`} tone={showHistory ? "ok" : "neutral"} />
              <ReadinessRow label="Predikce" value={showPrediction ? predictionModeLabel(predictionMode) : "vypnuto"} tone={showPrediction ? "ok" : "neutral"} />
              <div className="module-action-row">
                <button className="mini-button" disabled={!replayWindow} onClick={toggleReplayPlayback} type="button">
                  {replayRunning ? <Pause size={14} /> : <Play size={14} />}
                  {replayRunning ? "Pozastavit" : "Spustit"}
                </button>
                <button className="mini-button" onClick={() => openSettings("map")} type="button">
                  <Settings size={14} />
                  Režim
                </button>
              </div>
            </div>
          ) : null}

          {showRadioControls ? (
            <RadioLosControls
              customProfile={radioCustomProfile}
              gridStepM={radioGridStepM}
              linkFrom={radioLinkFrom}
              linkTo={radioLinkTo}
              mode={radioMode}
              profileId={radioProfileId}
              profiles={radioProfiles}
              profilesError={radioProfilesError}
              profilesStatus={radioProfilesStatus}
              radiusM={radioRadiusM}
              result={radioResult}
              mapPickTarget={radioPointPickTarget}
              searchTargets={radioSearchTargets}
              station={radioStation}
              useCustomProfile={radioUseCustomProfile}
              onApplyContext={applyRadioPointFromContext}
              onCustomProfileChange={setRadioCustomProfile}
              onGridStepMChange={setRadioGridStepM}
              onLinkFromChange={updateRadioLinkFrom}
              onLinkToChange={updateRadioLinkTo}
              onModeChange={updateRadioMode}
              onProfileIdChange={setRadioProfileId}
              onRadiusMChange={setRadioRadiusM}
              onRefreshProfiles={() => void loadRadioProfiles()}
              onRun={() => void runRadioLos()}
              onSaveCustomProfile={() => void saveCustomRadioProfile()}
              onSearchTargetsChange={updateRadioSearchTargets}
              onStartMapPick={startRadioPointPick}
              onStationChange={updateRadioStation}
              onUseCustomProfileChange={setRadioUseCustomProfile}
            />
          ) : null}

          {showSourceControls ? (
            <>
              <div className="source-list">
                <PanelTitle icon={<ShieldCheck size={17} />} title="Datové zdroje" />
                {sources.map((source) => (
                  <div className="source-row" key={source.sourceSystemId}>
                    <span className={`dot ${source.status === "ACTIVE" ? "ok" : "warn"}`} />
                    <div>
                      <strong>{source.displayName}</strong>
                      <small>{source.sourceSystemId}</small>
                    </div>
                    <em>{sourceRegistryStatusLabel(source.status)}</em>
                  </div>
                ))}
                {sources.length === 0 ? <div className="empty-mini">Datové zdroje zatím nejsou dostupné.</div> : null}
              </div>

              <StreamHealthPanel health={streamHealth} telemetry={streamTelemetry} />
              <SourceHealthCenter items={sourceHealth} />
            </>
          ) : null}
            </>
          )}
          {workspaceLayout.leftPanelMode === "open" && !showMapLayerControls ? (
            <button
              aria-label="Změnit šířku levého panelu"
              className="panel-resize-handle right"
              onPointerDown={(event) => beginWorkspacePanelResize("left", event)}
              title="Táhnutím změnit šířku panelu"
              type="button"
            />
          ) : null}
        </aside>
        ) : null}

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
            {activeWorkspace === "map" && weatherRadarSelected && weatherRadarFrames.length > 1 ? (
              <div className="weather-radar-playback-panel" aria-label="Přehrávání radarových snímků">
                <button
                  className="icon-chip"
                  onClick={() => setWeatherRadarPlaybackEnabled((current) => !current)}
                  type="button"
                >
                  {weatherRadarPlaybackEnabled ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <span>
                  Radar {formatWeatherRadarFrameTime(weatherRadarCurrentFrame)}
                </span>
                <button
                  className="icon-chip"
                  disabled={weatherRadarPlaybackStatus === "loading"}
                  onClick={() => setWeatherRadarFrameCatalogTick((current) => current + 1)}
                  type="button"
                >
                  <RefreshCw size={15} />
                </button>
              </div>
            ) : null}
            <CopMap
              alerts={mapAlerts}
              aoiRules={aoiRules}
              editingZoneId={editingZoneId}
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
              mapInteractionSuspended={(Boolean(mobileSheet) || settingsOpen) && !radioPointPickTarget}
              mapResizeSuspended={workspaceResizeActive}
              mobileSketchControlsOpen={mobileSketchOpen}
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
              mapLayerDetailLabel={mapLayerDetailLabel}
              mapLayerLabel={mapLayerLabel}
              situationFeatures={combinedSituationFeatures}
              onBoundsChange={setMapBounds}
              onSelectObject={(object) => {
                const isSelected = selectedObjectId === object.objectId;
                setSelectedObjectId(isSelected ? null : object.objectId);
                setSelectedSituationFeatureId(null);
                setSelectedSketchDrawingId(null);
                setMobileSketchOpen(false);
                setMobileSheet(mobileDetailSheetForSelection(isSelected));
              }}
              onSelectSituationFeature={(feature) => {
                if (isMobileTowerViewshedOverlayFeature(feature)) {
                  return;
                }
                const isSelected = selectedSituationFeatureId === feature.properties.featureId;
                setSelectedSituationFeatureId(isSelected ? null : feature.properties.featureId);
                setSelectedObjectId(null);
                setSelectedSketchDrawingId(null);
                setMobileSketchOpen(false);
                setMobileSheet(mobileDetailSheetForSelection(isSelected));
              }}
              onAutoFitChange={setAutoFit}
              onClearSelection={() => {
                setSelectedObjectId(null);
                setSelectedSituationFeatureId(null);
                setMobileSketchOpen(false);
                setMobileSheet(null);
              }}
              onCancelZoneCreation={() => setZoneCreationMode(false)}
              onCancelZoneEditing={() => setEditingZoneId(null)}
              onCreateZonePolygon={handleCreateAoiRuleFromPolygon}
              onUpdateZonePolygon={handleAoiRulePolygonUpdate}
              onPickReportLocation={handleCommunityReportLocationPicked}
              onPickRadioPoint={handleRadioPointPicked}
              onCreateSketchDrawing={handleCreateSketchDrawing}
              onDeleteSketchDrawing={handleDeleteSketchDrawing}
              onSelectSketchDrawing={(drawing) => {
                setSelectedSketchDrawingId(drawing?.id ?? null);
                if (drawing) {
                  setSelectedObjectId(null);
                  setSelectedSituationFeatureId(null);
                }
              }}
              onSketchModeChange={(mode) => {
                setSketchMode(mode);
                if (mode !== "select") {
                  setSelectedSketchDrawingId(null);
                }
              }}
              onUpdateSketchDrawing={handleUpdateSketchDrawing}
              onRequestUserLocation={locateUser}
              onViewChange={setMapView}
              radioPointPickActive={Boolean(radioPointPickTarget)}
              radioPointPickLabel={radioPointPickTarget ? radioPointPickTargetLabel(radioPointPickTarget) : undefined}
              reportLocationPickActive={communityReportLocationPickMode}
              selectedSketchDrawingId={selectedSketchDrawingId}
              showAlertAreas={showAlertAreas}
              showProximityAlertRadius={proximityAlertEnabled}
              sketchDrawings={visibleSketchLayerEnabled ? sketchDrawings : []}
              sketchMode={sketchMode}
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
                <React.Suspense fallback={<div className="empty-state compact">Načítám datovou tabulku...</div>}>
                  <TrackTable
                    objects={visibleObjects}
                    selectedObjectId={explicitlySelectedObject?.objectId}
                    onSelect={(objectId) => {
                      const isSelected = selectedObjectId === objectId;
                      setSelectedObjectId(isSelected ? null : objectId);
                      setSelectedSituationFeatureId(null);
                      setMobileSheet(mobileDetailSheetForSelection(isSelected));
                    }}
                  />
                </React.Suspense>
              </div>
              <DataWorkspaceBoard
                authToken={authToken}
                metrics={metrics}
                objects={visibleObjects}
                selectedObject={selectedObject ?? null}
                selectedSituationFeature={selectedSituationFeature}
                situationFeatures={combinedSituationFeatures}
                onOpenSettings={() => openSettings("data")}
              />
            </section>
          ) : showRadioControls ? (
            <RadioLosWorkspaceBoard
              overlay={radioOverlay}
              result={radioResult}
              selectedProfile={selectedRadioProfile}
              onClear={() => {
                setRadioOverlay(null);
                setRadioResult({ mode: radioMode, status: "idle", title: "Radio LoS", warnings: [] });
              }}
              onRun={() => void runRadioLos()}
            />
          ) : showSourceControls ? (
            <section className="operations-deck source-operations-deck">
              <div className="source-operations-board">
                <div className="deck-header">
                  <PanelTitle icon={<RadioTower size={17} />} title="Stav zdrojů" />
                  <span>{sourceHealth.length} zdrojů</span>
                </div>
                <ReadinessRow label="Letecká data" value={sourceHealthSummary(sourceHealth, "flight")} tone={sourceHealthTone(sourceHealth, "flight")} />
                <ReadinessRow label="Situační vrstvy" value={formatSituationReadiness(situationStatus, situationFeatures)} tone={situationStatusTone(situationStatus)} />
                <ReadinessRow label="Výstražné vrstvy" value={formatSafetyReadiness(safetyStatus, safetyFeatures)} tone={situationStatusTone(safetyStatus)} />
                <ReadinessRow label="Datové zdroje" value={`${sources.length} zdrojů`} tone={sources.length > 0 ? "ok" : "neutral"} />
                <ReadinessRow label="Technické události" value={String(technicalAlertSummary.total)} tone={technicalAlertSummary.total > 0 ? "warn" : "ok"} />
                <ReadinessRow label="Konflikty evidence" value={String(technicalAlertSummary.conflicts)} tone={technicalAlertSummary.conflicts > 0 ? "warn" : "ok"} />
                <ReadinessRow label="Lifecycle stop" value={String(technicalAlertSummary.lifecycle)} tone={technicalAlertSummary.lifecycle > 0 ? "warn" : "ok"} />
                <ReadinessRow label="Nízká jistota" value={String(technicalAlertSummary.lowConfidence)} tone={technicalAlertSummary.lowConfidence > 0 ? "warn" : "ok"} />
                <ReadinessRow label="Degradace zdrojů" value={String(technicalAlertSummary.sourceDegraded)} tone={technicalAlertSummary.sourceDegraded > 0 ? "warn" : "ok"} />
              </div>
              <div className="source-operations-board">
                <div className="deck-header">
                  <PanelTitle icon={<Activity size={17} />} title="Živé spojení" />
                  <span>{streamStatusLabel(streamStatus)}</span>
                </div>
                <ReadinessRow label="Stav" value={streamReadinessLabel(streamStatus, streamTelemetry)} tone={streamStatusTone(streamStatus)} />
                <ReadinessRow label="Odezva" value={formatStreamLatency(streamTelemetry.latencyMs)} tone={streamLatencyTone(streamTelemetry)} />
                <ReadinessRow label="Poslední signál" value={formatStreamObservation(streamTelemetry.lastHeartbeatAt)} tone={streamHeartbeatTone(streamTelemetry)} />
                <ReadinessRow label="Zátěž" value={formatBackpressureState(streamHealth, streamTelemetry)} tone={streamServerTone(streamHealth, streamTelemetry)} />
              </div>
            </section>
          ) : showAlertControls ? (
            <section className="operations-deck alert-operations-deck">
              <SafetyAlertBoard
                features={publicSafetyAlertFeatures}
                onSelectFeature={(featureId) => {
                  const isSelected = selectedSituationFeatureId === featureId;
                  setSelectedSituationFeatureId(isSelected ? null : featureId);
                  setSelectedObjectId(null);
                  setMobileSheet(mobileDetailSheetForSelection(isSelected));
                }}
              />
              <IncidentWorkflowBoard
                authenticated={profileAccessReady}
                error={incidentWorkflowError}
                incidents={incidents}
                loading={incidentWorkflowLoading}
                selectedIncidentId={selectedIncidentId}
                statusMessage={incidentWorkflowStatus}
                suggestions={incidentSuggestions}
                taskDraft={incidentTaskDraft}
                tasksByIncidentId={incidentTasksById}
                onAcceptSuggestion={(suggestion) => void handleAcceptIncidentSuggestion(suggestion)}
                onCreateTask={(incidentId, title) => void handleCreateIncidentTask(incidentId, title)}
                onRefresh={() => void loadIncidentWorkflow()}
                onSelectIncident={handleSelectIncident}
                onTaskDraftChange={setIncidentTaskDraft}
                onUpdateIncidentStatus={(incidentId, status) => void handleUpdateIncidentStatus(incidentId, status)}
                onUpdateTaskStatus={(incidentId, taskId, status) => void handleUpdateIncidentTaskStatus(incidentId, taskId, status)}
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
                  <PanelTitle icon={<ListFilter size={17} />} title="Objekty" />
                  <span>{formatObjectSearchCount(visibleObjects.length, visibleObjectsSearchScope.length, searchQuery)}</span>
                </div>
                <ObjectSearchControl
                  compact
                  resultCount={visibleObjects.length}
                  totalCount={visibleObjectsSearchScope.length}
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
                <React.Suspense fallback={<div className="empty-state compact">Načítám datovou tabulku...</div>}>
                  <TrackTable
                    objects={visibleObjects}
                    selectedObjectId={explicitlySelectedObject?.objectId}
                    onSelect={(objectId) => {
                      const isSelected = selectedObjectId === objectId;
                      setSelectedObjectId(isSelected ? null : objectId);
                      setSelectedSituationFeatureId(null);
                      setMobileSheet(mobileDetailSheetForSelection(isSelected));
                    }}
                  />
                </React.Suspense>
              </div>
              <div className="replay-board">
                <div className="deck-header">
                  <PanelTitle icon={<History size={17} />} title="Zpětné přehrání" />
                  <div className="deck-actions">
                    <button className="mini-button" disabled={!replayWindow} onClick={toggleReplayPlayback} type="button">
                      {replayRunning ? <Pause size={14} /> : <Play size={14} />}
                      {replayRunning ? "Pozastavit" : "Spustit"}
                    </button>
                    <button className="mini-button" disabled={!replayWindow || replayPosition >= 100} onClick={jumpToLive} type="button">
                      Živě
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

        {workspaceLayout.rightPanelMode !== "hidden" ? (
        <aside className="panel right-panel">
          {workspaceLayout.rightPanelMode === "collapsed" ? (
            <CollapsedPanelRail
              icon={<Database size={18} />}
              label={selectedSituationFeature || selectedObject ? "Detail" : "Info"}
              onExpand={() => updateWorkspaceLayout({ rightPanelMode: "open" })}
            />
          ) : (
            <>
          <MobileSheetPullHandle label="Stáhnout detail" onClose={() => setMobileSheet(null)} />
          {activeWorkspace !== "map" ? (
            <div className="workspace-context-card">
              <span>Workspace</span>
              <strong>{workspace.label}</strong>
              <p>{workspace.description}</p>
            </div>
          ) : null}

          <PanelTitle icon={<Database size={17} />} title={selectedSituationFeature ? "Detail prvku" : "Detail objektu"} />
          {selectedSituationFeature ? (
            <SituationFeatureDetail
              apiBase={apiBase}
              authToken={authToken}
              feature={selectedSituationFeature}
              mobileTowerViewshed={mobileTowerViewshed}
              onDeleteReport={(reportId) => void handleDeleteCommunityReport(reportId)}
              onEditReport={(feature) => editCommunityReportFeature(feature)}
              onOpenChat={(feature) => openCommunityReportChat(feature)}
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
            <div className="empty-state">Zatím nejsou k dispozici žádné viditelné objekty. Zapněte vrstvy nebo vyberte oblast s dostupnými daty.</div>
          )}

          {activeWorkspace === "data" || activeWorkspace === "sources" ? (
            <div className="readiness-box">
              <PanelTitle icon={<Gauge size={17} />} title="Stav dat" />
              <ReadinessRow label="Datové zdroje" value={metrics.activeSources > 0 ? "aktivní" : "čekají"} tone={metrics.activeSources > 0 ? "ok" : "warn"} />
              <ReadinessRow label="Spojení" value={operatingModeLabel(operatingMode)} tone={operatingModeTone(operatingMode)} />
              <ReadinessRow label="Uložený náhled" value={formatOfflineSnapshotState(offlineSnapshotState)} tone={offlineSnapshotTone(offlineSnapshotState)} />
              <ReadinessRow label="Cvičná data" value={includeSynthetic ? "zobrazena" : "skryta"} tone={includeSynthetic ? "ok" : "neutral"} />
              <ReadinessRow label="Veřejné lety" value={String(metrics.publicFlightCount)} tone={metrics.publicFlightCount > 0 ? "ok" : "neutral"} />
              <ReadinessRow label="Situační vrstvy" value={formatSituationReadiness(situationStatus, situationFeatures)} tone={situationStatusTone(situationStatus)} />
              <ReadinessRow label="Výstražné vrstvy" value={formatSafetyReadiness(safetyStatus, safetyFeatures)} tone={situationStatusTone(safetyStatus)} />
              <ReadinessRow label="Živé spojení" value={streamReadinessLabel(streamStatus, streamTelemetry)} tone={streamStatusTone(streamStatus)} />
            </div>
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
              <span className="auth-hint">Přihlášení najdete v horní liště.</span>
            )}
          </div>
          ) : null}
            </>
          )}
          {workspaceLayout.rightPanelMode === "open" ? (
            <button
              aria-label="Změnit šířku pravého panelu"
              className="panel-resize-handle left"
              onPointerDown={(event) => beginWorkspacePanelResize("right", event)}
              title="Táhnutím změnit šířku detailu"
              type="button"
            />
          ) : null}
        </aside>
        ) : null}
      </section>

      </section>

      {mobileSheet === "layers" ? (
        <MobileSheetSurface
          title={activeCatalogGroup?.group.label ?? "Vrstvy"}
          subtitle="Katalog vrstev"
          onClose={() => setMobileSheet(null)}
        >
          <CatalogLayerMenu
            activeGroup={activeCatalogGroup}
            compactDrawerHeader
            groups={catalogGroupViews}
            loadError={loadError}
            statusLabel={missionModeLabel(operatingMode, offlineSnapshotState)}
            onCloseDrawer={() => setMobileSheet(null)}
            onGroupSelect={setActiveCatalogGroupId}
            getFeatureCount={catalogLayerFeatureCount}
            getLayerStatus={catalogLayerStatus}
            isLayerEnabled={isCatalogLayerEnabled}
            isLayerOperable={isCatalogLayerOperable}
            onToggleLayer={toggleCatalogLayer}
            coverageTechnology={coverageTechnology}
            onCoverageTechnologyChange={setCoverageTechnology}
            userZones={aoiRules}
            zoneCreationMode={zoneCreationMode}
            editingZoneId={editingZoneId}
            onUserZoneColorChange={handleAoiRuleColorChange}
            onUserZoneCreateFromMap={handleCreateAoiRuleFromMap}
            onUserZoneCreateFromUserLocation={handleCreateAoiRuleFromUserLocation}
            onUserZoneDelete={handleAoiRuleDelete}
            onUserZoneEnabledChange={handleAoiRuleEnabledChange}
            onUserZoneEdit={handleStartAoiRuleEdit}
            onUserZoneRadiusChange={handleAoiRuleRadiusChange}
            onUserZoneStartDrawing={() => {
              setEditingZoneId(null);
              setZoneCreationMode((current) => !current);
              setMobileSheet(null);
            }}
          />
        </MobileSheetSurface>
      ) : null}

      {mobileSheet === "detail" ? (
        <MobileSheetSurface
          title={selectedSituationFeature ? "Detail prvku" : explicitlySelectedObject ? "Detail objektu" : "Detail"}
          subtitle="Mapa"
          onClose={() => setMobileSheet(null)}
        >
          {selectedSituationFeature ? (
            <SituationFeatureDetail
              apiBase={apiBase}
              authToken={authToken}
              feature={selectedSituationFeature}
              mobileTowerViewshed={mobileTowerViewshed}
              onDeleteReport={(reportId) => void handleDeleteCommunityReport(reportId)}
              onEditReport={(feature) => editCommunityReportFeature(feature)}
              onOpenChat={(feature) => openCommunityReportChat(feature)}
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
            <div className="empty-state">Vyberte objekt nebo mapový prvek.</div>
          )}
        </MobileSheetSurface>
      ) : null}

      <MobileBottomNav
        activeSheet={mobileSheet}
        chatUnreadCount={messagingUnreadCount}
        messagingOpen={messagingOpen}
        settingsOpen={settingsOpen}
        sketchOpen={mobileSketchOpen}
        onChat={() => {
          setSettingsOpen(false);
          setMobileSheet(null);
          setMobileSketchOpen(false);
          setMessagingOpen(true);
          setMessagingPinned(true);
        }}
        onLayers={() => {
          setSettingsOpen(false);
          setMessagingOpen(false);
          setActiveWorkspace("map");
          setMobileSketchOpen(false);
          if (workspaceLayout.leftPanelMode !== "open") {
            updateWorkspaceLayout({ leftPanelMode: "open" });
          }
          const firstCatalogGroupId = catalogGroupViews[0]?.group.groupId;
          if (mobileSheet !== "layers" && !activeCatalogGroupId && firstCatalogGroupId) {
            setActiveCatalogGroupId(firstCatalogGroupId);
          }
          setMobileSheet((current) => current === "layers" ? null : "layers");
        }}
        onMap={() => {
          setSettingsOpen(false);
          setMessagingOpen(false);
          setActiveWorkspace("map");
          setMobileSketchOpen(false);
          setMobileSheet(null);
        }}
        onMenu={() => {
          setMobileSheet(null);
          setMobileSketchOpen(false);
          setMessagingOpen(false);
          if (settingsOpen) {
            setSettingsOpen(false);
            return;
          }
          openSettings("map");
        }}
        onReport={() => {
          setSettingsOpen(false);
          setMessagingOpen(false);
          setMobileSheet(null);
          setMobileSketchOpen(false);
          startCommunityReportCapture();
        }}
        onSketch={() => {
          setSettingsOpen(false);
          setActiveWorkspace("map");
          setMobileSheet(null);
          setMessagingOpen(false);
          setMobileSketchOpen((current) => !current);
        }}
      />

      {workspaceLayout.statusbarVisible ? <footer className="app-statusbar" aria-label="Provozní stav aplikace">
        {activeWorkspace === "map" ? (
          <WorkspaceLayoutControls
            layout={workspaceLayout}
            onChange={updateWorkspaceLayout}
          />
        ) : null}
        <span className={streamStatusTone(streamStatus)}>
          <Activity size={15} />
          Spojení {streamStatusLabel(streamStatus)}
        </span>
        <span className={operatingModeTone(operatingMode)}>
          <Wifi size={15} />
          Režim {operatingModeLabel(operatingMode)}
        </span>
        <span>
          <Clock3 size={15} />
          Poslední aktualizace {lastLoadedAt ?? "čekám"}
        </span>
        <span>
          <ShieldCheck size={15} />
          Verze 0.1.0
        </span>
      </footer> : null}

      {settingsOpen ? (
        <SettingsDrawer
          activeTab={settingsTab}
          alertRadiusKm={alertRadiusKm}
          apiBase={apiBase}
          aoiRule={primaryAoiRule}
          authConfig={authConfig}
          authDiagnostics={authDiagnostics}
          authSession={authSession}
          authToken={authToken}
          autoRefresh={autoRefresh}
          demoScenario={demoScenario}
          demoScenarioBusy={demoScenarioBusy}
          demoScenarioError={demoScenarioError}
          includeSynthetic={includeSynthetic}
          language={language}
          mapBasemapMode={mapBasemapMode}
          minConfidence={minConfidence}
          operatorProfile={effectiveOperatorProfile}
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
          webPushBusy={webPushBusy}
          webPushState={webPushState}
          workspaceLayout={workspaceLayout}
          workspaceSkin={workspaceSkin}
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
          onDemoScenarioRefresh={() => void refreshDemoScenario()}
          onDemoScenarioReset={() => void handleResetDemoScenario()}
          onDemoScenarioSeed={() => void handleSeedDemoScenario()}
          onIncludeSyntheticChange={setIncludeSynthetic}
          onLanguageChange={setLanguage}
          onMapBasemapModeChange={setMapBasemapMode}
          onMinConfidenceChange={setMinConfidence}
          onMapClusterEnabledChange={setMapClusterEnabled}
          onOperatorProfileChange={setOperatorProfile}
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
          onDisableWebPush={() => void handleDisableWebPush()}
          onEnableWebPush={() => void handleEnableWebPush()}
          onWorkspaceSkinChange={setWorkspaceSkin}
          onWorkspaceTemplateApply={applyWorkspaceTemplate}
          onWorkspaceLayoutChange={updateWorkspaceLayout}
          onHelp={(section) => setHelpSection(section)}
          onLogin={() => loginOperator({ promptLogin: true })}
          onLogout={logoutOperator}
        />
      ) : null}

      {messagingOpen ? (
        <EmbeddedCopChatPanel
          dockWidth={messagingDockWidth}
          pinned={messagingPinned}
          selection={messagingSelection}
          onClose={() => setMessagingOpen(false)}
          onDockWidthChange={(width) => {
            const nextWidth = clamp(width, messagingDockWidthRange.min, messagingDockWidthRange.max);
            setMessagingDockWidth(nextWidth);
            writeMessagingDockWidth(nextWidth);
          }}
        />
      ) : null}

      {loginPromptReason ? (
        <LoginRequiredDialog
          reason={loginPromptReason}
          onClose={() => setLoginPromptReason(null)}
          onContinue={continueLoginFromPrompt}
        />
      ) : null}

      {accountChangeNotice ? (
        <AccountChangedDialog
          notice={accountChangeNotice}
          onLoginDifferent={loginDifferentOperator}
          onStaySignedOut={staySignedOutAfterAccountChange}
          onSwitch={switchToChangedAccount}
        />
      ) : null}

      {helpSection ? (
        <ManualDialog
          section={helpSection}
          onClose={() => setHelpSection(null)}
          onSectionChange={setHelpSection}
        />
      ) : null}

      {communityReportOpen ? (
        <CommunityReportDialog
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
      {mobilePairCodeFromPath ? <MobilePairLandingOverlay code={mobilePairCodeFromPath} /> : null}
    </main>
  );
}

function readMobilePairCodeFromLocation(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const match = window.location.pathname.match(/^\/mobile\/pair\/([A-Za-z0-9_-]{16,96})$/u);
  return match?.[1] ?? null;
}

function MobilePairLandingOverlay({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false);
  const universalLink = `${window.location.origin}/mobile/pair/${encodeURIComponent(code)}`;
  const customSchemeUrl = `csm://pair?code=${encodeURIComponent(code)}`;

  const copyLink = async () => {
    if (!navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(universalLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mobile-pair-landing-backdrop" role="dialog" aria-modal="true" aria-label="Spárování CSM Messenger">
      <div className="mobile-pair-landing-card">
        <div className="mobile-pair-landing-icon">
          <Smartphone size={42} />
        </div>
        <h2>Spárovat CSM Messenger</h2>
        <p>
          Odkaz obsahuje jen krátkodobý pairing kód. Přístupové tokeny, recovery klíče ani Matrix klíče se přes COP REST nepředávají.
        </p>
        <code>{code}</code>
        <div className="settings-button-row">
          <a className="primary-button" href={customSchemeUrl}>
            <ExternalLink size={16} />
            Otevřít v aplikaci
          </a>
          <button className="mini-button" onClick={() => void copyLink()} type="button">
            <Copy size={14} />
            {copied ? "Zkopírováno" : "Kopírovat link"}
          </button>
        </div>
        <button className="mini-button wide" onClick={() => window.history.replaceState({}, "", "/")} type="button">
          Pokračovat do COP
        </button>
      </div>
    </div>
  );
}

interface CommunityReportDraft {
  category: CommunityReportCategory;
  description: string;
  files: File[];
  groupId?: string;
  groupName?: string;
  hazardSeverity: CommunityReportHazardSeverity;
  location: CommunityReportLocation;
  mediaLocationHint: string;
  mediaAccessMode: CommunityMediaAccessMode;
  mediaAccessUserSubjectIds: string;
  reportId?: string;
  title: string;
  validUntil: string;
  videoSpatialMode: CommunityVideoSpatialMode;
}

interface MessagingSelectionCommand {
  id: string;
  nonce: number;
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
  draft: CommunityReportDraft;
  error: string | null;
  isSubmitting: boolean;
  success: string | null;
  uploadProgress: CommunityUploadUiState | null;
  onChange: React.Dispatch<React.SetStateAction<CommunityReportDraft>>;
  onClose: () => void;
  onFilesSelected: (files: File[]) => void;
  onLocationFromMap: () => void;
  onLocationFromMapClick: () => void;
  onLocationFromUser: () => void;
  onSubmit: () => void;
}

function CommunityReportDialog({
  draft,
  error,
  isSubmitting,
  success,
  uploadProgress,
  onChange,
  onClose,
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
            <strong>Přístup k přílohám</strong>
            <span>{communityMediaAccessLabel(draft.mediaAccessMode)}</span>
          </div>
          <span className="report-field-hint">
            Hlášení zůstane mapový objekt. Skupiny a konverzace řeší samostatná aplikace Chat.
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
          <span className="report-field-hint">
            Text hlášení a stupeň výstrahy se zobrazují v mapě. Fotky, PDF a videa respektují zvolený přístup.
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
  const previewUrl = attachment ? communityAttachmentPreviewUrl(attachment) : undefined;
  const photoUrl = attachment?.kind === "photo" ? attachment.contentUrl ?? previewUrl : undefined;
  const videoPosterUrl = attachment?.kind === "video" ? previewUrl : undefined;
  const documentPreviewUrl = attachment?.kind === "document" ? previewUrl : undefined;
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
          {photoUrl ? (
            <img alt={attachment.fileName ?? "Fotografie hlášení"} src={photoUrl} />
          ) : null}
          {attachment.contentUrl && attachment.kind === "video" ? (
            <video controls playsInline preload="metadata" src={attachment.contentUrl} />
          ) : null}
          {!attachment.contentUrl && videoPosterUrl ? (
            <div className="community-gallery-video-poster">
              <img alt={attachment.fileName ?? "Video hlášení"} src={videoPosterUrl} />
              <span>
                <Play size={28} />
                Demo náhled videa
              </span>
            </div>
          ) : null}
          {attachment.contentUrl && attachment.kind === "document" ? (
            <iframe src={attachment.contentUrl} title={attachment.fileName ?? "PDF příloha"} />
          ) : null}
          {!attachment.contentUrl && documentPreviewUrl ? (
            <div className="community-gallery-document-preview">
              <img alt={attachment.fileName ?? "PDF příloha"} src={documentPreviewUrl} />
              <strong>{attachment.fileName ?? "PDF příloha"}</strong>
            </div>
          ) : null}
          {!attachment.contentUrl && !previewUrl ? (
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

function AccountChangedDialog({
  notice,
  onLoginDifferent,
  onStaySignedOut,
  onSwitch
}: {
  notice: AccountChangeNotice;
  onLoginDifferent: () => void;
  onStaySignedOut: () => void;
  onSwitch: () => void;
}) {
  const changed = notice.kind === "changed";
  return (
    <ModalDialog
      actions={
        <>
          <button className="ghost-button" onClick={onStaySignedOut} type="button">
            Zůstat odhlášen
          </button>
          <button className="ghost-button" onClick={onLoginDifferent} type="button">
            <LogIn size={16} />
            Přihlásit jiný účet
          </button>
          {changed ? (
            <button className="primary-button" onClick={onSwitch} type="button">
              Přepnout účet
            </button>
          ) : null}
        </>
      }
      className="account-changed-dialog"
      description={
        changed
          ? "V jiném okně nebo webové instalaci se přihlásil jiný účet. Toto okno se nepřepnulo automaticky."
          : "V jiném okně nebo webové instalaci došlo k odhlášení. Toto okno už nepoužívá původní relaci."
      }
      eyebrow="Zabezpečení účtu"
      onClose={onStaySignedOut}
      title={changed ? "Účet byl změněn v jiném okně" : "Účet byl odhlášen v jiném okně"}
    >
      <div className="login-required-body">
        <div className="login-required-note">
          <ShieldCheck size={17} />
          <span>Vyberte, zda chcete převzít nově přihlášený účet, nebo v tomto okně pokračovat bez přihlášení.</span>
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
        benefits: ["Hlášení bude obsahovat autora, polohu a platnost.", "Přílohy se uloží s řízeným přístupem podle zvolené viditelnosti."],
        description: "Vlastní hlášení může obsahovat fotky, video, PDF a citlivou polohu, proto je potřeba ověřený účet.",
        title: "Přihlaste se pro vložení hlášení"
      };
    case "account":
    default:
      return {
        benefits: ["Odemkne se ukládání profilu a osobních zón.", "Zpřístupní se konverzace, hlášení a chráněná média."],
        description: "Přihlášení doplní veřejný režim o osobní a komunitní funkce.",
        title: "Přihlášení k aplikaci"
      };
  }
}

function SafetyAlertBoard({
  features,
  onSelectFeature
}: {
  features: SituationFeature[];
  onSelectFeature: (featureId: string) => void;
}) {
  const summary = summarizeSafetyAlerts(features);
  return (
    <div className="alert-center-board">
      <div className="deck-header">
        <PanelTitle icon={<AlertTriangle size={17} />} title="Výstrahy" />
        <span>{features.length} aktivních</span>
      </div>
      <div className="alert-summary-grid">
        <MetricTile label="Kritické" value={summary.critical} tone={summary.critical > 0 ? "warn" : "ok"} />
        <MetricTile label="Varování" value={summary.warning} tone={summary.warning > 0 ? "warn" : "ok"} />
      </div>
      <div className="alert-list">
        {features.length === 0 ? <div className="empty-mini">Žádné aktivní safety výstrahy ze SIM.</div> : null}
        {features.map((feature) => {
          const severityRank = priorityFeatureSeverityRank(feature);
          const status = situationFeatureStatusModel(feature);
          const rowTone = severityRank >= 3 ? "critical" : severityRank >= 2 ? "warning" : "info";
          const observedAt = latestTimestamp([
            feature.properties.observedAt,
            feature.properties.effectiveAt,
            feature.properties.validFrom,
            feature.properties.updatedAt,
            feature.properties.generatedAt
          ]);
          return (
            <article className={`alert-row ${rowTone}`} key={feature.properties.featureId}>
              <div className="alert-severity-mark" aria-hidden="true" />
              <div className="alert-row-body">
                <div className="alert-row-heading">
                  <strong>{priorityFeatureTitle(feature)}</strong>
                  <span>{status.label}</span>
                </div>
                <p>{feature.properties.description ?? feature.properties.recommendedAction ?? "Oficiální safety vrstva ze SIM."}</p>
                <div className="alert-row-meta">
                  <button type="button" onClick={() => onSelectFeature(feature.properties.featureId)}>{feature.properties.featureId}</button>
                  <span>{priorityFeatureBadge(feature)}</span>
                  <span>{sourceDisplayName(feature.properties.sourceId)}</span>
                  <span>{formatShortDateTime(observedAt)}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function IncidentWorkflowBoard({
  authenticated,
  error,
  incidents,
  loading,
  selectedIncidentId,
  statusMessage,
  suggestions,
  taskDraft,
  tasksByIncidentId,
  onAcceptSuggestion,
  onCreateTask,
  onRefresh,
  onSelectIncident,
  onTaskDraftChange,
  onUpdateIncidentStatus,
  onUpdateTaskStatus
}: {
  authenticated: boolean;
  error: string | null;
  incidents: IncidentRecord[];
  loading: boolean;
  selectedIncidentId: string | null;
  statusMessage: string | null;
  suggestions: IncidentFusionSuggestion[];
  taskDraft: string;
  tasksByIncidentId: Record<string, IncidentTaskRecord[]>;
  onAcceptSuggestion: (suggestion: IncidentFusionSuggestion) => void;
  onCreateTask: (incidentId: string, title: string) => void;
  onRefresh: () => void;
  onSelectIncident: (incidentId: string) => void;
  onTaskDraftChange: (value: string) => void;
  onUpdateIncidentStatus: (incidentId: string, status: IncidentStatus) => void;
  onUpdateTaskStatus: (incidentId: string, taskId: string, status: IncidentTaskStatus) => void;
}) {
  const selectedIncident = incidents.find((incident) => incident.incidentId === selectedIncidentId) ?? incidents[0] ?? null;
  const selectedTasks = selectedIncident ? tasksByIncidentId[selectedIncident.incidentId] ?? [] : [];

  return (
    <div className="incident-workflow-board">
      <div className="deck-header">
        <PanelTitle icon={<ClipboardList size={17} />} title="Incidenty a úkoly" />
        <button className="mini-button" disabled={loading} onClick={onRefresh} type="button">
          <RefreshCw size={14} />
          {loading ? "Načítám" : "Obnovit"}
        </button>
      </div>

      {!authenticated ? (
        <div className="empty-mini">Incidentní workflow je dostupné po přihlášení operátora.</div>
      ) : (
        <>
          <div className="incident-summary-grid">
            <MetricTile label="Incidenty" value={incidents.length} tone={incidents.length > 0 ? "warn" : "ok"} />
            <MetricTile label="Návrhy" value={suggestions.length} tone={suggestions.length > 0 ? "warn" : "ok"} />
          </div>
          {error ? <div className="incident-warning">{humanizeApiError(error)}</div> : null}
          {statusMessage && !error ? <div className="incident-status-message">{statusMessage}</div> : null}

          <section className="incident-section">
            <div className="incident-section-heading">
              <strong>Návrhy z fúze dat</strong>
              <span>{suggestions.length}</span>
            </div>
            <div className="incident-suggestion-list">
              {suggestions.length === 0 ? <div className="empty-mini">Žádné nové návrhy z hlášení v aktuálním pohledu.</div> : null}
              {suggestions.map((suggestion) => (
                <article className="incident-suggestion-card" key={suggestion.suggestionId}>
                  <div>
                    <div className="incident-card-title">
                      <strong>{suggestion.title}</strong>
                      <span className={`incident-pill ${suggestion.severity}`}>{incidentSeverityLabel(suggestion.severity)}</span>
                    </div>
                    <p>{suggestion.explanation}</p>
                    <div className="incident-meta">
                      <span>{suggestion.metrics.reportCount} hlášení</span>
                      <span>{formatIncidentDistance(suggestion.metrics.maxDistanceM)}</span>
                      <span>{formatIncidentTimeSpan(suggestion.metrics.timeSpanSeconds)}</span>
                      <span>{formatIncidentConfidence(suggestion.confidence)}</span>
                    </div>
                  </div>
                  <button className="mini-button" onClick={() => onAcceptSuggestion(suggestion)} type="button">
                    <Plus size={14} />
                    Převzít
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="incident-section">
            <div className="incident-section-heading">
              <strong>Aktivní incidenty</strong>
              <span>{incidents.length}</span>
            </div>
            <div className="incident-list">
              {incidents.length === 0 ? <div className="empty-mini">Zatím nejsou vytvořené incidenty.</div> : null}
              {incidents.map((incident) => (
                <button
                  className={clsx("incident-card", incident.incidentId === selectedIncident?.incidentId && "selected")}
                  key={incident.incidentId}
                  onClick={() => onSelectIncident(incident.incidentId)}
                  type="button"
                >
                  <span className={`incident-severity-dot ${incident.severity}`} aria-hidden="true" />
                  <span>
                    <strong>{incident.title}</strong>
                    <small>{incidentCategoryLabel(incident.category)} · {incidentStatusLabel(incident.status)} · {formatIncidentConfidence(incident.confidence)}</small>
                  </span>
                  <span>{formatShortDateTime(incident.updatedAt)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="incident-task-panel">
            {selectedIncident ? (
              <>
                <div className="incident-card-title">
                  <div>
                    <span className="section-eyebrow">Vybraný incident</span>
                    <strong>{selectedIncident.title}</strong>
                  </div>
                  <span className={`incident-pill ${selectedIncident.severity}`}>{incidentSeverityLabel(selectedIncident.severity)}</span>
                </div>
                <p>{selectedIncident.description ?? "Bez doplňujícího popisu."}</p>
                <div className="incident-status-actions">
                  {(["active", "monitoring", "resolved"] satisfies IncidentStatus[]).map((status) => (
                    <button
                      className={clsx("mini-button", selectedIncident.status === status && "active")}
                      disabled={selectedIncident.status === status}
                      key={status}
                      onClick={() => onUpdateIncidentStatus(selectedIncident.incidentId, status)}
                      type="button"
                    >
                      {status === "resolved" ? <CheckCircle2 size={14} /> : null}
                      {incidentStatusLabel(status)}
                    </button>
                  ))}
                </div>
                <form
                  className="incident-task-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onCreateTask(selectedIncident.incidentId, taskDraft);
                  }}
                >
                  <input
                    aria-label="Nový úkol"
                    onChange={(event) => onTaskDraftChange(event.target.value)}
                    placeholder="Nový úkol k incidentu"
                    value={taskDraft}
                  />
                  <button className="mini-button" disabled={!taskDraft.trim()} type="submit">
                    <Plus size={14} />
                    Přidat
                  </button>
                </form>
                <div className="incident-task-list">
                  {selectedTasks.length === 0 ? <div className="empty-mini">Zatím nejsou založené úkoly.</div> : null}
                  {selectedTasks.map((task) => (
                    <article className="incident-task-row" key={task.taskId}>
                      <div>
                        <strong>{task.title}</strong>
                        <span>{incidentTaskPriorityLabel(task.priority)} · {incidentTaskStatusLabel(task.status)}</span>
                      </div>
                      <div className="incident-task-actions">
                        {task.status !== "in_progress" && task.status !== "done" ? (
                          <button className="mini-button" onClick={() => onUpdateTaskStatus(selectedIncident.incidentId, task.taskId, "in_progress")} type="button">
                            Rozpracovat
                          </button>
                        ) : null}
                        {task.status !== "done" ? (
                          <button className="mini-button" onClick={() => onUpdateTaskStatus(selectedIncident.incidentId, task.taskId, "done")} type="button">
                            <CheckCircle2 size={14} />
                            Hotovo
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-mini">Vyberte incident. Tady se zobrazí úkoly a stav řešení.</div>
            )}
          </section>
        </>
      )}
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
  authToken,
  metrics,
  objects,
  selectedObject,
  selectedSituationFeature,
  situationFeatures,
  onOpenSettings
}: {
  authToken: string | undefined;
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
        <DataMetric label="Nízká jistota" value={String(metrics.lowConfidenceCount)} tone={metrics.lowConfidenceCount > 0 ? "warn" : "ok"} />
        <DataMetric label="Neaktuální" value={String(staleOrLostCount)} tone={staleOrLostCount > 0 ? "warn" : "ok"} />
        <DataMetric label="Kontext" value={String(contextCount)} tone={contextCount > 0 ? "ok" : "neutral"} />
      </div>

      {selectedSituationFeature ? (
        <SelectedSituationDataCard authToken={authToken} feature={selectedSituationFeature} />
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
          ["Stav", <StatusBadge key="status" label={objectStatusLabel(object.status)} tone={objectStatusTone(object.status)} />],
          ["Typ", `${object.objectType} / ${object.domain}`],
          ["Jistota", formatOptionalPercent(object.confidence)],
          ["Zdroj", provenance?.sourceSystemId ?? "n/a"],
          ["Aktualizace", formatShortDateTime(object.lastUpdatedAt ?? provenance?.producerTimestamp)]
        ]}
      />
    </ObjectDetailSection>
  );
}

function SelectedSituationDataCard({ authToken, feature }: { authToken: string | undefined; feature: SituationFeature }) {
  const status = situationFeatureStatusModel(feature);
  const weatherCamera = isWeatherWebcamFeature(feature);
  const weatherContext = isWeatherContextFeature(feature) && !isAviationWeatherFeature(feature) && !weatherCamera;
  const rows: Array<[string, React.ReactNode]> = [
    ["Název", weatherCamera ? weatherWebcamTitle(feature) : weatherContext ? weatherFeatureHeadline(feature) : feature.properties.headline ?? feature.properties.label],
    ["Vrstva", situationDisplayLayerLabel(feature)],
    ["Stav", <StatusBadge key="status" label={status.label} tone={status.tone} />],
    [weatherContext || weatherCamera ? "Typ" : "Kategorie", weatherCamera ? "Webkamera" : weatherContext ? weatherFeatureTypeLabel(feature) : feature.properties.category],
    ["Zdroj", feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId)],
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
      {isSafetyLayerId(feature.properties.layer) ? <SafetyRiskSummary authToken={authToken} feature={feature} /> : null}
      {isAviationWeatherFeature(feature) ? <AviationWeatherSummary feature={feature} /> : null}
      {weatherCamera ? <WeatherWebcamSummary feature={feature} /> : null}
      {weatherContext ? <WeatherContextSummary feature={feature} /> : null}
    </ObjectDetailSection>
  );
}

interface MobileNetworkDisplayData {
  assumptions: Record<string, unknown>;
  basis?: string[];
  btsStatus?: string;
  confidence?: number;
  dataQuality?: string;
  demSource?: string;
  disclaimer?: string;
  estimatedSignalDbm?: number;
  generatedAt?: string;
  metrics?: Record<string, unknown>;
  modelVersion?: string;
  notices?: string[];
  operator?: string;
  operatorStatusAvailable?: boolean;
  quality?: string;
  readModel?: boolean;
  resolutionM?: number;
  sourceRevision?: string;
  status?: string;
  summary?: string;
  technology?: string;
}

function MobileCoverageSummary({ feature }: { feature: SituationFeature }) {
  const properties = mobileNetworkDisplayData(feature.properties);
  const quality = mobileCoverageQualityModel(properties.quality);
  return (
    <div className="mobile-status-summary">
      <DataMetric label="Kvalita" value={quality.label} tone={quality.tone} />
      <DataMetric label="Režim" value={mobileNetworkModelLabel(properties)} tone="neutral" />
      <DataMetric label="Technologie" value={properties.technology ?? "n/a"} tone="neutral" />
      <DataMetric label="Jistota" value={formatOptionalPercent(properties.confidence)} tone="neutral" />
      <DataMetric label="Operátor" value={mobileNetworkBtsStatusLabel(properties)} tone="neutral" />
      <DataMetric label="Rozlišení" value={formatOptionalNumber(properties.resolutionM, " m")} tone="neutral" />
    </div>
  );
}

function mobileNetworkDisplayData(properties: SituationFeature["properties"]): MobileNetworkDisplayData {
  const provider = isRecord(properties.providerProperties) ? properties.providerProperties : {};
  const assumptions = isRecord(properties.assumptions)
    ? properties.assumptions
    : isRecord(provider.assumptions)
      ? provider.assumptions
      : {};
  const metrics = isRecord(properties.metrics)
    ? properties.metrics
    : isRecord(provider.metrics)
      ? provider.metrics
      : undefined;
  return {
    assumptions,
    basis: mobileStringArrayField(properties, provider, "basis"),
    btsStatus: mobileStringField(properties, provider, "btsStatus"),
    confidence: numberProperty(properties.confidence) ?? numberProperty(provider.confidence),
    dataQuality: mobileStringField(properties, provider, "dataQuality"),
    demSource: mobileStringField(properties, provider, "demSource"),
    disclaimer: mobileStringField(properties, provider, "disclaimer"),
    estimatedSignalDbm: numberProperty(properties.estimatedSignalDbm) ?? numberProperty(provider.estimatedSignalDbm),
    generatedAt: mobileStringField(properties, provider, "generatedAt"),
    metrics,
    modelVersion: mobileStringField(properties, provider, "modelVersion"),
    notices: mobileStringArrayField(properties, provider, "notices"),
    operator: mobileStringField(properties, provider, "operator"),
    operatorStatusAvailable: booleanProperty(properties.operatorStatusAvailable) ?? booleanProperty(provider.operatorStatusAvailable),
    quality: mobileStringField(properties, provider, "quality"),
    readModel: booleanProperty(properties.readModel) ?? booleanProperty(provider.readModel),
    resolutionM: numberProperty(properties.resolutionM) ?? numberProperty(provider.resolutionM),
    sourceRevision: mobileStringField(properties, provider, "sourceRevision"),
    status: mobileStringField(properties, provider, "status"),
    summary: mobileStringField(properties, provider, "summary"),
    technology: mobileStringField(properties, provider, "technology")
  };
}

function mobileStringField(properties: SituationFeature["properties"], provider: Record<string, unknown>, key: keyof SituationFeature["properties"]): string | undefined {
  return stringProperty(properties[key]) ?? stringProperty(provider[key]);
}

function mobileStringArrayField(properties: SituationFeature["properties"], provider: Record<string, unknown>, key: keyof SituationFeature["properties"]): string[] | undefined {
  const direct = properties[key];
  if (Array.isArray(direct)) {
    return direct.map((item) => stringProperty(item)).filter((item): item is string => Boolean(item));
  }
  const provided = provider[key];
  if (Array.isArray(provided)) {
    return provided.map((item) => stringProperty(item)).filter((item): item is string => Boolean(item));
  }
  return undefined;
}

function formatMobileTerrainState(assumptions: Record<string, unknown>): string {
  const terrainApplied = booleanProperty(assumptions.terrainApplied);
  const terrainDataAvailable = booleanProperty(assumptions.terrainDataAvailable);
  const model = stringProperty(assumptions.propagationModel);
  const appliedLabel = terrainApplied === true ? "terén aplikován" : terrainApplied === false ? "terén neaplikován" : "stav terénu n/a";
  const dataLabel = terrainDataAvailable === true ? "DEM dostupný" : terrainDataAvailable === false ? "DEM nedostupný" : "DEM n/a";
  return [appliedLabel, dataLabel, model].filter(Boolean).join(" · ");
}

function formatMobileAntennaAssumptions(assumptions: Record<string, unknown>): string {
  const antennaHeight = numberProperty(assumptions.antennaHeightM);
  const receiverHeight = numberProperty(assumptions.receiverHeightM);
  const landCoverAware = booleanProperty(assumptions.landCoverAware);
  return [
    antennaHeight !== undefined ? `BTS ${antennaHeight} m` : undefined,
    receiverHeight !== undefined ? `klient ${receiverHeight} m` : undefined,
    landCoverAware === true ? "land-cover zohledněn" : landCoverAware === false ? "bez land-cover" : undefined
  ].filter(Boolean).join(" · ") || "n/a";
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

function WeatherWebcamSummary({ feature }: { feature: SituationFeature }) {
  const camera = weatherWebcamMetadata(feature);
  const locationLabel = weatherWebcamLocationLabel(feature, null) ?? weatherWebcamTitle(feature);
  return (
    <div className="mobile-status-summary weather-camera-summary">
      <DataMetric label="Místo" value={locationLabel} tone="neutral" />
      <DataMetric label="Náhled" value={camera.snapshotUrl ? "dostupný" : "čeká na detail"} tone={camera.snapshotUrl ? "ok" : "neutral"} />
      <DataMetric label="Detail" value={camera.detailUrl ? "dostupný" : "n/a"} tone={camera.detailUrl ? "ok" : "neutral"} />
      <DataMetric label="Atribuce" value="ČHMÚ" tone="neutral" />
    </div>
  );
}

function WeatherWebcamPreview({ authToken, feature }: { authToken: string | undefined; feature: SituationFeature }) {
  const fallbackCamera = React.useMemo(() => weatherWebcamMetadata(feature), [feature]);
  const detailUrl = fallbackCamera.detailUrl;
  const [detail, setDetail] = React.useState<WeatherWebcamDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [imageFailed, setImageFailed] = React.useState(false);

  const loadDetail = React.useCallback(async () => {
    if (!detailUrl) {
      return;
    }
    const proxyUrl = weatherCameraProxyUrl(detailUrl);
    if (!proxyUrl) {
      setDetail(null);
      setDetailError("Detail kamery není dostupný přes povolenou COP/SIM proxy.");
      return;
    }
    setLoading(true);
    setDetailError(null);
    try {
      const response = await fetch(proxyUrl, {
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setDetail(normalizeWeatherWebcamDetail(await response.json()));
      setSelectedIndex(0);
    } catch (error) {
      setDetail(null);
      setDetailError(error instanceof Error ? humanizeApiError(error.message) : "Detail kamery se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }, [authToken, detailUrl]);

  React.useEffect(() => {
    if (!detailUrl) {
      setDetail(null);
      setDetailError(null);
      setLoading(false);
      return;
    }
    void loadDetail();
  }, [detailUrl, loadDetail]);

  const cameras = React.useMemo(() => weatherWebcamCandidates(fallbackCamera, detail), [detail, fallbackCamera]);
  const activeIndex = Math.min(selectedIndex, Math.max(0, cameras.length - 1));
  const activeCamera = cameras[activeIndex] ?? fallbackCamera;
  const snapshotUrl = weatherCameraProxyUrl(activeCamera.snapshotUrl);
  const locationLabel = weatherWebcamLocationLabel(feature, detail) ?? weatherWebcamTitle(feature);
  const locationCoordinates = weatherWebcamLocationCoordinates(feature, detail);
  const activeCameraLabel = weatherCameraDisplayLabel(activeCamera, locationLabel, activeIndex);

  React.useEffect(() => {
    setImageFailed(false);
  }, [snapshotUrl]);

  return (
    <ObjectDetailSection title="Náhled kamery">
      <div className="weather-camera-window">
        <div className="weather-camera-window-header">
          <span><Camera size={15} /> {activeCameraLabel}</span>
          {detailUrl ? (
            <button className="mini-button" disabled={loading} onClick={() => void loadDetail()} type="button">
              {loading ? "Načítám" : "Obnovit"}
            </button>
          ) : null}
        </div>
        <div className="weather-camera-meta">
          <span>Název lokality</span>
          <strong>{locationLabel}</strong>
          <span>Poloha</span>
          <strong>{locationCoordinates}</strong>
        </div>
        {cameras.length > 1 ? (
          <div aria-label="Kamery" className="weather-camera-tabs" role="tablist">
            {cameras.map((camera, index) => (
              <button
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "active" : ""}
                key={`${camera.label}-${index}`}
                onClick={() => setSelectedIndex(index)}
                role="tab"
                type="button"
              >
                {weatherCameraDisplayLabel(camera, locationLabel, index)}
              </button>
            ))}
          </div>
        ) : null}
        {detailError ? <div className="weather-camera-error">{detailError}</div> : null}
        {loading && !detail ? <div className="weather-camera-empty">Načítám náhled kamery...</div> : null}
        {snapshotUrl && !imageFailed ? (
          <figure className="weather-camera-frame">
            <img alt={activeCameraLabel} onError={() => setImageFailed(true)} src={snapshotUrl} />
            <figcaption>
              {[activeCamera.observedAt ? formatShortDateTime(activeCamera.observedAt) : undefined, activeCamera.direction].filter(Boolean).join(" · ") || "Aktuální dostupný snapshot"}
            </figcaption>
          </figure>
        ) : !loading ? (
          <div className="weather-camera-empty">Snapshot zatím není v datech dostupný.</div>
        ) : null}
        <div className="weather-camera-attribution">Zdroj: Český hydrometeorologický ústav</div>
      </div>
    </ObjectDetailSection>
  );
}

function weatherCameraDisplayLabel(camera: WeatherCameraInfo, locationLabel: string, index: number): string {
  const label = normalizeWeatherWebcamDisplayLabel(camera.label ?? "");
  if (label && label !== "Webkamera ČHMÚ" && !/^Kamera\s+\d+$/i.test(label)) {
    return label;
  }
  return index > 0 ? `${locationLabel} (${index + 1})` : locationLabel;
}

function CommunicationTowerSummary({ feature }: { feature: SituationFeature }) {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return (
    <div className="mobile-status-summary">
      <DataMetric label="Typ" value={stringProperty(tags.towerType) ?? "communication"} tone="neutral" />
      <DataMetric label="OSM" value={formatOsmReference(tags)} tone="neutral" />
      <DataMetric label="Podklad" value="OSM reference" tone="neutral" />
      <DataMetric label="Stav BTS" value={formatCommunicationTowerStatus(feature.properties.btsStatus)} tone="neutral" />
      <DataMetric label="Jistota" value={formatOptionalPercent(feature.properties.confidence)} tone="neutral" />
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

function WeatherContextSummary({ feature }: { feature: SituationFeature }) {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const display = weatherDisplayRecord(feature);
  if (display && isMeasuredWeatherStationFeature(feature)) {
    const tone = weatherFeatureTone(feature);
    const summaryCards = [
      <DataMetric key="state" label="Stav" value={weatherFeatureConditionLabel(feature, metrics)} tone={tone} />,
      weatherDisplayString(feature, "primaryValue")
        ? <DataMetric key="primary" label="Hodnota" value={weatherDisplayString(feature, "primaryValue") as string} tone={tone} />
        : null,
      weatherDisplayString(feature, "secondaryValue")
        ? <DataMetric key="secondary" label="Doplňkově" value={weatherDisplayString(feature, "secondaryValue") as string} tone="neutral" />
        : null,
      weatherDisplayString(feature, "tertiaryValue")
        ? <DataMetric key="tertiary" label="Další" value={weatherDisplayString(feature, "tertiaryValue") as string} tone="neutral" />
        : null,
      <DataMetric
        key="mode"
        label="Typ závěru"
        value={weatherConditionModeLabel(weatherDisplayString(feature, "conditionMode")) ?? "měření"}
        tone="neutral"
      />,
      <DataMetric
        key="confidence"
        label="Jistota"
        value={formatOptionalPercentFromWhole(weatherDisplayNumber(feature, "confidencePercent"), feature.properties.confidence)}
        tone="neutral"
      />
    ].filter(Boolean);
    return <div className="mobile-status-summary weather-context-summary">{summaryCards}</div>;
  }
  if (isMeasuredWeatherStationFeature(feature)) {
    const temperatureC = weatherMeasuredMetric(metrics, "temperatureC");
    const windSpeedMps = weatherMeasuredMetric(metrics, "windSpeedMps");
    const windGustMps = weatherMeasuredMetric(metrics, "windGustMps");
    const windDirectionDeg = weatherMeasuredMetric(metrics, "windDirectionDeg");
    const precipitation10mMm = weatherMeasuredMetric(metrics, "precipitation10mMm", "precipitationMm");
    const humidityPercent = weatherMeasuredMetric(metrics, "relativeHumidityPercent", "humidityPercent");
    const pressureHpa = weatherMeasuredMetric(metrics, "pressureHpa", "pressureHpaSeaLevel");
    const cards = [
      temperatureC !== undefined ? <DataMetric key="temperature" label="Teplota" value={formatOptionalNumber(temperatureC, " °C")} tone={weatherTemperatureTone(temperatureC)} /> : null,
      windSpeedMps !== undefined || windGustMps !== undefined || windDirectionDeg !== undefined
        ? <DataMetric key="wind" label="Vítr" value={formatMeasuredWeatherWind(windDirectionDeg, windSpeedMps, windGustMps)} tone={weatherMeasuredWindTone(windSpeedMps, windGustMps)} />
        : null,
      precipitation10mMm !== undefined ? <DataMetric key="precipitation" label="Srážky 10 min" value={formatPrecipitationAmount(precipitation10mMm)} tone={weatherMeasuredPrecipitationTone(precipitation10mMm)} /> : null,
      humidityPercent !== undefined ? <DataMetric key="humidity" label="Vlhkost" value={`${Math.round(humidityPercent)} %`} tone={humidityPercent >= 95 ? "warn" : "neutral"} /> : null,
      pressureHpa !== undefined ? <DataMetric key="pressure" label="Tlak" value={`${Math.round(pressureHpa)} hPa`} tone="neutral" /> : null
    ].filter(Boolean);
    if (cards.length > 0) {
      return <div className="mobile-status-summary weather-context-summary">{cards}</div>;
    }
  }
  return (
    <div className="mobile-status-summary weather-context-summary">
      <DataMetric label="Hodnota" value={weatherFeatureValueLabel(feature, metrics) ?? "n/a"} tone={weatherFeatureTone(feature)} />
      <DataMetric label="Charakter" value={weatherFeatureConditionLabel(feature, metrics)} tone={weatherFeatureTone(feature)} />
      <DataMetric label="Podklad" value={weatherDataQualityLabel(stringProperty(feature.properties.dataQuality)) ?? "měření/model"} tone="neutral" />
      <DataMetric label="Zdroj" value={feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId)} tone="neutral" />
    </div>
  );
}

function WeatherStationDetailPanel({
  apiBase,
  authToken,
  feature
}: {
  apiBase: string;
  authToken: string | undefined;
  feature: SituationFeature;
}) {
  const detailUrl = React.useMemo(() => weatherStationDetailUrl(feature), [feature]);
  const [detail, setDetail] = React.useState<WeatherStationDetailResponse | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const loadDetail = React.useCallback(async () => {
    if (!detailUrl) {
      return;
    }
    setLoading(true);
    setDetailError(null);
    try {
      setDetail(await fetchWeatherStationDetail(apiBase, authToken, detailUrl, {
        forecastHours: 24,
        historyHours: 48
      }));
    } catch (error) {
      setDetail(null);
      setDetailError(error instanceof Error ? humanizeApiError(error.message) : "Detail meteorologické stanice se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, authToken, detailUrl]);

  React.useEffect(() => {
    if (!isMeasuredWeatherStationFeature(feature) || !detailUrl) {
      setDetail(null);
      setDetailError(null);
      setLoading(false);
      return;
    }
    void loadDetail();
  }, [detailUrl, feature, loadDetail]);

  if (!isMeasuredWeatherStationFeature(feature)) {
    return null;
  }
  if (!detailUrl) {
    return <div className="weather-station-detail-empty">Detail meteorologické stanice zatím není dostupný.</div>;
  }

  const currentDisplay = detail?.current?.display;
  const title = currentDisplay?.title ?? weatherFeatureHeadline(feature);
  const subtitle = currentDisplay?.subtitle ?? weatherFeatureSubtitle(feature);
  const charts = detail?.charts ?? [];

  return (
    <div className="weather-station-detail">
      <div className="weather-station-detail-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <button className="mini-button" disabled={loading} onClick={() => void loadDetail()} type="button">
          {loading ? "Načítám" : "Obnovit"}
        </button>
      </div>
      {currentDisplay ? (
        <div className="mobile-status-summary weather-context-summary">
          <DataMetric label="Stav" value={currentDisplay.badgeLabel ?? "měření"} tone={weatherDisplayToneFromDisplay(currentDisplay.badgeTone)} />
          <DataMetric label="Hodnota" value={currentDisplay.primaryValue ?? "n/a"} tone={weatherDisplayToneFromDisplay(currentDisplay.badgeTone)} />
          <DataMetric label="Doplňkově" value={[currentDisplay.secondaryValue, currentDisplay.tertiaryValue].filter(Boolean).join(" · ") || "n/a"} tone="neutral" />
          <DataMetric label="Typ závěru" value={weatherConditionModeLabel(currentDisplay.conditionMode) ?? "měření"} tone="neutral" />
          <DataMetric label="Jistota" value={formatOptionalPercentFromWhole(currentDisplay.confidencePercent, currentDisplay.confidence)} tone="neutral" />
        </div>
      ) : null}
      {detailError ? <div className="weather-station-detail-error">{detailError}</div> : null}
      {loading && !detail ? <div className="weather-station-detail-empty">Načítám měření a grafy ČHMÚ...</div> : null}
      {detail ? (
        <>
          <WeatherStationCharts charts={charts} />
          <div className="weather-station-attribution">{formatWeatherStationAttribution(detail.attribution)}</div>
        </>
      ) : null}
    </div>
  );
}

function weatherDisplayToneFromDisplay(value: string | undefined): "neutral" | "ok" | "warn" | "critical" {
  switch (value?.toLowerCase()) {
    case "critical":
    case "danger":
    case "error":
      return "critical";
    case "warning":
    case "warn":
    case "advisory":
      return "warn";
    case "ok":
    case "success":
    case "info":
      return "ok";
    default:
      return "neutral";
  }
}

function WeatherStationCharts({ charts }: { charts: WeatherStationChart[] }) {
  const visibleCharts = charts.filter((chart) => (chart.series ?? []).some((series) => weatherChartSeriesPoints(series).length > 0));
  if (visibleCharts.length === 0) {
    return <div className="weather-station-detail-empty">Grafy zatím nejsou v detailu stanice dostupné.</div>;
  }
  return (
    <div className="weather-station-chart-grid">
      {visibleCharts.map((chart, index) => (
        <WeatherStationChartPanel chart={chart} key={`${weatherStationChartId(chart) ?? chart.title ?? "chart"}-${index}`} />
      ))}
    </div>
  );
}

function WeatherStationChartPanel({ chart }: { chart: WeatherStationChart }) {
  const series = (chart.series ?? [])
    .map((item, index) => ({ item, index, points: weatherChartSeriesPoints(item) }))
    .filter((entry) => entry.points.length > 0);
  const allPoints = series.flatMap((entry) => entry.points);
  const timeDomain = weatherChartTimeDomain(allPoints);
  const valueDomain = weatherChartValueDomain(allPoints.map((point) => point.value));
  const width = 640;
  const height = 175;
  const padding = { bottom: 24, left: 48, right: 14, top: 18 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (time: string) => padding.left + ((Date.parse(time) - timeDomain.min) / Math.max(1, timeDomain.max - timeDomain.min)) * chartWidth;
  const y = (value: number) => padding.top + chartHeight - ((value - valueDomain.min) / Math.max(1, valueDomain.max - valueDomain.min)) * chartHeight;
  const unit = weatherStationChartUnit(chart, series);

  return (
    <div className="weather-station-chart-panel">
      <div className="weather-station-chart-title">
        <strong>{chart.title ?? chart.id ?? "Graf"}</strong>
        <span>{unit}</span>
      </div>
      <svg aria-label={chart.title ?? "Graf počasí"} className="weather-station-chart-svg" role="img" viewBox={`0 0 ${width} ${height}`}>
        <line className="weather-chart-axis" x1={padding.left} x2={padding.left + chartWidth} y1={padding.top + chartHeight} y2={padding.top + chartHeight} />
        <line className="weather-chart-axis" x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + chartHeight} />
        <text className="weather-chart-axis-label" x={padding.left} y={height - 6}>{formatShortTime(timeDomain.min)}</text>
        <text className="weather-chart-axis-label end" x={padding.left + chartWidth} y={height - 6}>{formatShortTime(timeDomain.max)}</text>
        <text className="weather-chart-axis-label" x={4} y={padding.top + 6}>{formatWeatherChartAxisValue(valueDomain.max, unit)}</text>
        <text className="weather-chart-axis-label" x={4} y={padding.top + chartHeight}>{formatWeatherChartAxisValue(valueDomain.min, unit)}</text>
        {series.map((entry) => (
          <polyline
            className={`weather-chart-series ${weatherStationChartSeriesRole(entry.item)}`}
            fill="none"
            key={`${weatherStationChartSeriesId(entry.item) ?? entry.item.label ?? "series"}-${entry.index}`}
            points={entry.points.map((point) => `${x(point.time)},${y(point.value)}`).join(" ")}
            stroke={entry.item.color ?? weatherChartPalette(entry.index)}
          />
        ))}
      </svg>
      <div className="weather-station-chart-legend">
        {series.map((entry) => (
          <span key={`${weatherStationChartSeriesId(entry.item) ?? entry.item.label ?? "series"}-legend-${entry.index}`}>
            <i style={{ borderColor: entry.item.color ?? weatherChartPalette(entry.index) }} />
            {entry.item.label ?? weatherStationChartSeriesId(entry.item) ?? `řada ${entry.index + 1}`}
          </span>
        ))}
      </div>
    </div>
  );
}

export function formatWeatherStationAttribution(attribution: WeatherStationDetailResponse["attribution"]): string {
  if (typeof attribution === "string") {
    const trimmed = attribution.trim();
    return trimmed || "Zdroj: Český hydrometeorologický ústav";
  }
  if (Array.isArray(attribution)) {
    const labels = attribution
      .map(formatWeatherStationAttributionItem)
      .filter((label) => label.length > 0);
    return labels.length > 0 ? `Zdroj: ${Array.from(new Set(labels)).join(" · ")}` : "Zdroj: Český hydrometeorologický ústav";
  }
  return "Zdroj: Český hydrometeorologický ústav";
}

function formatWeatherStationAttributionItem(item: WeatherStationAttribution): string {
  const label = stringProperty(item.label) ?? sourceDisplayName(stringProperty(item.sourceId));
  const role = weatherStationAttributionRoleLabel(stringProperty(item.role));
  return [label, role].filter(Boolean).join(" / ");
}

function weatherStationAttributionRoleLabel(role: string | undefined): string | undefined {
  switch (role) {
    case "observation":
      return "měření";
    case "forecast":
      return "předpověď";
    default:
      return role;
  }
}

function weatherStationChartId(chart: WeatherStationChart): string | undefined {
  return chart.id ?? chart.chartId;
}

function weatherStationChartSeriesId(series: NonNullable<WeatherStationChart["series"]>[number]): string | undefined {
  return series.id ?? series.seriesId;
}

function weatherStationChartSeriesRole(series: NonNullable<WeatherStationChart["series"]>[number]): "forecast" | "measured" {
  const role = series.role ?? series.style ?? series.source;
  if (role === "forecast" || role === "dashed" || role === "open_meteo" || /předpověď/i.test(series.label ?? "")) {
    return "forecast";
  }
  return "measured";
}

function weatherStationChartUnit(
  chart: WeatherStationChart,
  series: Array<{ item: NonNullable<WeatherStationChart["series"]>[number] }>
): string {
  return chart.unit
    ?? chart.yUnit
    ?? chart.yAxis?.unit
    ?? series.find((entry) => entry.item.unit)?.item.unit
    ?? "";
}

function weatherChartSeriesPoints(series: NonNullable<WeatherStationChart["series"]>[number]): Array<{ time: string; value: number }> {
  return (series.points ?? []).flatMap((point) => {
    const time = stringProperty(point.time) ?? stringProperty(point.at);
    const value = numberProperty(point.value);
    return time && value !== undefined && Number.isFinite(Date.parse(time)) ? [{ time, value }] : [];
  });
}

function weatherChartTimeDomain(points: Array<{ time: string }>): { max: number; min: number } {
  const values = points.map((point) => Date.parse(point.time)).filter(Number.isFinite);
  if (values.length === 0) {
    const now = Date.now();
    return { max: now + 60 * 60 * 1000, min: now - 60 * 60 * 1000 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(30 * 60 * 1000, (max - min) * 0.04);
  return { max: max + padding, min: min - padding };
}

function weatherChartValueDomain(values: number[]): { max: number; min: number } {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return { max: 1, min: 0 };
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) {
    const padding = Math.max(1, Math.abs(max) * 0.1);
    return { max: max + padding, min: min - padding };
  }
  const padding = (max - min) * 0.12;
  return { max: max + padding, min: min - padding };
}

function weatherChartPalette(index: number): string {
  return ["#38bdf8", "#a7f3d0", "#fbbf24", "#c084fc", "#fb7185"][index % 5] ?? "#38bdf8";
}

function formatWeatherChartAxisValue(value: number, unit: string | undefined): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(Math.abs(value) < 10 ? 1 : 0);
  return unit ? `${rounded} ${unit}` : rounded;
}

function SafetyRiskSummary({ authToken, feature }: { authToken: string | undefined; feature: SituationFeature }) {
  const properties = feature.properties;
  const metrics = isRecord(properties.metrics) ? properties.metrics : {};
  const isFlood = properties.layer === "flood";
  const status = isFlood ? null : situationFeatureStatusModel(feature);
  const hydroDetailUrl = React.useMemo(() => hydrologyDetailUrl(properties), [properties.detailUrl, properties.stationId, properties.tags, properties.timelineUrl]);
  const [hydroDetail, setHydroDetail] = React.useState<HydroStationDetailResponse | null>(null);
  const [hydroError, setHydroError] = React.useState<string | null>(null);
  const [hydroLoading, setHydroLoading] = React.useState(false);
  const loadHydroDetail = React.useCallback(async () => {
    if (!hydroDetailUrl) {
      return;
    }
    setHydroLoading(true);
    setHydroError(null);
    try {
      setHydroDetail(await fetchSafetyHydroStationDetail(apiBase, authToken, hydroDetailUrl));
    } catch (error) {
      setHydroDetail(null);
      setHydroError(error instanceof Error ? humanizeApiError(error.message) : "Detail hydrologické stanice se nepodařilo načíst.");
    } finally {
      setHydroLoading(false);
    }
  }, [authToken, hydroDetailUrl]);

  React.useEffect(() => {
    if (properties.layer !== "flood" || !hydroDetailUrl) {
      setHydroDetail(null);
      setHydroError(null);
      setHydroLoading(false);
      return;
    }
    void loadHydroDetail();
  }, [hydroDetailUrl, loadHydroDetail, properties.layer]);

  const canonicalTypeCode = safetyCanonicalTypeCode(properties);
  const canonicalSourceCode = safetyCanonicalSourceCode(properties);
  const canonicalSourceSystem = safetyCanonicalSourceSystem(properties);
  const presentation = safetyProviderPresentation(properties);
  const detailText = safetyDetailText(properties);
  const rows: Array<[string, React.ReactNode]> = isFlood ? [] : [
    ["Jev", safetyDisplayLabel(properties)],
    ["Typ jevu", canonicalTypeCode ? humanizeSafetyTypeCode(canonicalTypeCode) : "n/a"],
    ["Strojový typ", canonicalTypeCode ?? "n/a"],
    ["Stav", status ? <StatusBadge key="status" label={status.label} tone={status.tone} /> : "n/a"],
    ["Oblast", properties.areaName ?? properties.affectedArea ?? formatStringList(properties.affectedAreas)],
    ["Geometrie", safetyGeometryModeLabel(properties.geometryMode, feature.geometry.type)],
    ["Platí od", formatShortDateTime(properties.validFrom ?? properties.effectiveAt)],
    ["Platí do", formatShortDateTime(properties.validUntil ?? properties.expiresAt)],
    ["Zdroj", properties.sourceName ?? properties.source ?? properties.sourceId],
    ["Podklady", safetyBasisLabel(properties.basis)],
    ["Push kandidát", safetyNotificationEligibleLabel(properties)]
  ];
  if (!isFlood && canonicalSourceCode) {
    rows.splice(3, 0, ["Zdrojový kód", canonicalSourceCode]);
  }
  if (!isFlood && canonicalSourceSystem) {
    rows.splice(canonicalSourceCode ? 4 : 3, 0, ["Zdrojový systém", canonicalSourceSystem]);
  }
  if (!isFlood && stringProperty(presentation.iconKey)) {
    rows.push(["Ikona", stringProperty(presentation.iconKey)]);
  }
  if (!isFlood && stringProperty(presentation.styleKey)) {
    rows.push(["Styl", stringProperty(presentation.styleKey)]);
  }
  if (!isFlood && detailText) {
    rows.push(["Detail", detailText]);
  }

  if (isFlood) {
    rows.push(
      ["Tok", properties.riverName ?? "n/a"],
      ["Stanice", properties.areaName ? [properties.areaName, properties.stationId].filter(Boolean).join(" · ") : properties.stationId ?? "n/a"],
      ["Předpověď", formatHydroForecast(properties, metrics)],
      ["Stáří měření", formatDurationSeconds(safetyMetricNumber(properties, metrics, "observationAgeSeconds"))],
      ["Povodí", properties.basin ?? stringProperty(properties.tags?.hydrologicalOrder) ?? "n/a"],
      ["Plocha povodí", formatOptionalNumber(safetyMetricNumber(properties, metrics, "catchmentAreaKm2"), " km2")],
      ["Prahy SPA", formatFloodThresholds(metrics)]
    );
  }

  if (properties.layer === "fire") {
    rows.push(
      ["Požární stav", fireStatusLabel(properties.fireStatus ?? properties.status)],
      ["Typ zdroje", fireSourceIncidentLabel(properties.sourceIncident)],
      ["Potvrzení", fireConfirmationLabel(canonicalTypeCode, properties.sourceIncident)],
      ["Poznámka", fireRiskNotice(properties)]
    );
  }

  return (
    <ObjectDetailSection title={isFlood ? "Hydrologie" : properties.layer === "fire" ? "Požární riziko" : "Výstraha"}>
      {isFlood ? <HydrologyStatusOverview feature={feature} metrics={metrics} /> : null}
      <DetailGrid rows={rows} />
      {isFlood ? (
        <HydroStationDetailCard
          detail={hydroDetail}
          detailUrl={hydroDetailUrl}
          error={hydroError}
          loading={hydroLoading}
          onRefresh={loadHydroDetail}
        />
      ) : null}
    </ObjectDetailSection>
  );
}

function HydrologyStatusOverview({ feature, metrics }: { feature: SituationFeature; metrics: Record<string, unknown> }) {
  const properties = feature.properties;
  const floodStage = safetyMetricNumber(properties, metrics, "floodStage", "floodActivityLevel") ?? 0;
  const stage = floodStageStatusModel(floodStage);
  const trend = floodTrendLabel(properties.trend);
  const trendTone = floodTrendTone(properties.trend);
  return (
    <div className="hydro-status-overview">
      <div className={`hydro-status-card ${stage.tone}`}>
        <span>Stupeň povodňové aktivity</span>
        <strong>{floodStageLabel(floodStage)}</strong>
      </div>
      <div className={`hydro-status-card ${trendTone}`}>
        <span>Trend</span>
        <strong>{trend}</strong>
      </div>
      <div className="hydro-status-card neutral">
        <span>Vodní stav</span>
        <strong>{formatOptionalNumber(safetyMetricNumber(properties, metrics, "waterLevelCm"), " cm")}</strong>
      </div>
      <div className="hydro-status-card neutral">
        <span>Průtok</span>
        <strong>{formatOptionalNumber(safetyMetricNumber(properties, metrics, "discharge", "flowM3s"), " m3/s")}</strong>
      </div>
      <div className="hydro-status-card neutral">
        <span>Teplota vody</span>
        <strong>{formatOptionalNumber(safetyMetricNumber(properties, metrics, "waterTemperatureC"), " °C")}</strong>
      </div>
    </div>
  );
}

function HydroStationDetailCard({
  detail,
  detailUrl,
  error,
  loading,
  onRefresh
}: {
  detail: HydroStationDetailResponse | null;
  detailUrl: string | undefined;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (!detailUrl) {
    return <div className="hydro-detail-empty">Detailní graf pro tento hlásný profil zatím není dostupný.</div>;
  }
  return (
    <div className="hydro-detail">
      <div className="hydro-detail-header">
        <div>
          <strong>{detail?.chart.title ?? "Detail hlásného profilu"}</strong>
          <span>{detail ? `${formatShortDateTime(detail.window.from)} - ${formatShortDateTime(detail.window.to)}` : "Časová řada ČHMÚ"}</span>
        </div>
        <button className="mini-button" disabled={loading} onClick={onRefresh} type="button">
          {loading ? "Načítám" : "Obnovit"}
        </button>
      </div>
      {error ? <div className="hydro-detail-error">{error}</div> : null}
      {loading && !detail ? <div className="hydro-detail-empty">Načítám hydrologická měření...</div> : null}
      {detail ? <HydroStationChart detail={detail} /> : null}
      {detail?.warnings.length ? <div className="hydro-detail-warning">{detail.warnings.slice(0, 2).join(" · ")}</div> : null}
    </div>
  );
}

function HydroStationChart({ detail }: { detail: HydroStationDetailResponse }) {
  const panels = detail.chart.panels.filter((panel) => panel.seriesIds.some((seriesId) => hydroSeriesById(detail, seriesId)?.points.length));
  if (panels.length === 0) {
    return <div className="hydro-detail-empty">Pro zvolené období zatím nejsou dostupné hodnoty grafu.</div>;
  }
  return (
    <div className="hydro-chart">
      {panels.map((panel) => (
        <HydroChartPanel detail={detail} key={panel.id} panel={panel} />
      ))}
      <div className="hydro-chart-legend">
        <span><i className="legend-line measured" /> měření</span>
        <span><i className="legend-line forecast" /> předpověď</span>
        <span><i className="legend-line dry" /> sucho</span>
        <span><i className="legend-line spa" /> SPA</span>
        <span><i className="legend-line now" /> aktuální čas</span>
      </div>
    </div>
  );
}

function HydroChartPanel({
  detail,
  panel
}: {
  detail: HydroStationDetailResponse;
  panel: HydroStationDetailResponse["chart"]["panels"][number];
}) {
  const series = panel.seriesIds
    .map((seriesId) => hydroSeriesById(detail, seriesId))
    .filter((item): item is NonNullable<ReturnType<typeof hydroSeriesById>> => Boolean(item && item.points.length));
  const allPoints = series.flatMap((item) => item.points);
  const timeDomain = hydroTimeDomain(allPoints, detail.chart.currentTime);
  const thresholdValues = hydroThresholdLines(detail, panel.thresholdSet).map((line) => line.value);
  const valueDomain = hydroValueDomain([...allPoints.map((point) => point.value), ...thresholdValues]);
  const width = 640;
  const height = panel.id === "temperature" ? 150 : 190;
  const padding = { bottom: 26, left: 54, right: 16, top: 20 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (at: string) => padding.left + ((Date.parse(at) - timeDomain.min) / Math.max(1, timeDomain.max - timeDomain.min)) * chartWidth;
  const y = (value: number) => padding.top + chartHeight - ((value - valueDomain.min) / Math.max(1, valueDomain.max - valueDomain.min)) * chartHeight;
  const nowX = x(detail.chart.currentTime);

  return (
    <div className="hydro-chart-panel">
      <div className="hydro-chart-panel-title">
        <strong>{panel.title}</strong>
        <span>{panel.yAxis.unit}</span>
      </div>
      <svg aria-label={panel.title} className="hydro-chart-svg" role="img" viewBox={`0 0 ${width} ${height}`}>
        <line className="hydro-axis" x1={padding.left} x2={padding.left + chartWidth} y1={padding.top + chartHeight} y2={padding.top + chartHeight} />
        <line className="hydro-axis" x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + chartHeight} />
        <text className="hydro-axis-label" x={padding.left} y={height - 6}>{formatShortTime(timeDomain.min)}</text>
        <text className="hydro-axis-label end" x={padding.left + chartWidth} y={height - 6}>{formatShortTime(timeDomain.max)}</text>
        <text className="hydro-axis-label" x={4} y={padding.top + 6}>{formatHydroAxisValue(valueDomain.max, panel.yAxis.unit)}</text>
        <text className="hydro-axis-label" x={4} y={padding.top + chartHeight}>{formatHydroAxisValue(valueDomain.min, panel.yAxis.unit)}</text>
        {hydroThresholdLines(detail, panel.thresholdSet).map((line) => (
          <g key={line.key}>
            <line className={`hydro-threshold ${line.key}`} x1={padding.left} x2={padding.left + chartWidth} y1={y(line.value)} y2={y(line.value)} />
            <text className={`hydro-threshold-label ${line.key}`} x={padding.left + 4} y={y(line.value) - 4}>{line.label}</text>
          </g>
        ))}
        {Number.isFinite(nowX) ? <line className="hydro-now-line" x1={nowX} x2={nowX} y1={padding.top} y2={padding.top + chartHeight} /> : null}
        {series.map((item) => (
          <polyline
            className={`hydro-series ${item.role === "forecast" ? "forecast" : "measured"} ${item.id}`}
            fill="none"
            key={item.id}
            points={item.points.map((point) => `${x(point.at)},${y(point.value)}`).join(" ")}
          />
        ))}
      </svg>
    </div>
  );
}

function hydrologyDetailUrl(properties: SituationFeature["properties"]): string | undefined {
  const directUrl = properties.detailUrl ?? properties.timelineUrl;
  if (directUrl) {
    return directUrl;
  }
  const tags = isRecord(properties.tags) ? properties.tags : {};
  const stationId = properties.stationId ?? recordString(tags, "stationId");
  if (stationId) {
    return `/safety-data/api/v1/hydro/stations/${encodeURIComponent(stationId)}/observations`;
  }
  return undefined;
}

function hydroSeriesById(detail: HydroStationDetailResponse, seriesId: HydroSeriesId): HydroStationDetailResponse["series"][number] | undefined {
  return detail.series.find((series) => series.id === seriesId);
}

function hydroTimeDomain(points: Array<{ at: string }>, currentTime: string): { max: number; min: number } {
  const values = [...points.map((point) => Date.parse(point.at)), Date.parse(currentTime)].filter(Number.isFinite);
  if (values.length === 0) {
    const now = Date.now();
    return { max: now + 60 * 60 * 1000, min: now - 60 * 60 * 1000 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(30 * 60 * 1000, (max - min) * 0.04);
  return { max: max + padding, min: min - padding };
}

function hydroValueDomain(values: number[]): { max: number; min: number } {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return { max: 1, min: 0 };
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) {
    return { max: max + Math.max(1, Math.abs(max) * 0.1), min: min - Math.max(1, Math.abs(min) * 0.1) };
  }
  const padding = (max - min) * 0.12;
  return { max: max + padding, min: Math.max(0, min - padding) };
}

function hydroThresholdLines(
  detail: HydroStationDetailResponse,
  thresholdSet: "discharge" | "waterLevel" | undefined
): Array<{ key: string; label: string; value: number }> {
  if (!thresholdSet) {
    return [];
  }
  const thresholds = detail.thresholds[thresholdSet];
  return [
    { key: "dry", label: "sucho", value: thresholds.dry },
    { key: "spa1", label: "SPA 1", value: thresholds.spa1 },
    { key: "spa2", label: "SPA 2", value: thresholds.spa2 },
    { key: "spa3", label: "SPA 3", value: thresholds.spa3 },
    { key: "spa4", label: "SPA 4", value: thresholds.spa4 }
  ].flatMap((item) => typeof item.value === "number" && Number.isFinite(item.value) ? [{ ...item, value: item.value }] : []);
}

function formatHydroAxisValue(value: number, unit: string): string {
  return `${Math.round(value * 10) / 10} ${normalizeHydroUnit(unit)}`;
}

function normalizeHydroUnit(unit: string): string {
  return unit === "0C" ? "°C" : unit;
}

function formatShortTime(value: number): string {
  return new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function StatusBadge({ label, tone }: { label: string; tone: "neutral" | "ok" | "warn" | "critical" }) {
  return <span className={`status-badge ${tone}`}>{label}</span>;
}

function formatUnreadBadge(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "";
  }
  return count > 99 ? "99+" : String(Math.trunc(count));
}

function EmbeddedCopChatPanel({
  dockWidth,
  pinned,
  selection,
  onClose,
  onDockWidthChange
}: {
  dockWidth: number;
  pinned: boolean;
  selection: MessagingSelectionCommand | null;
  onClose: () => void;
  onDockWidthChange: (width: number) => void;
}) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const initialSelectedChatIdRef = React.useRef(selection?.id ?? null);

  React.useEffect(() => {
    if (!selection?.id || !iframeRef.current?.contentWindow) {
      return;
    }
    iframeRef.current.contentWindow.postMessage(
      encodeChatSelect(selection.id),
      window.location.origin
    );
  }, [selection?.id, selection?.nonce]);

  function beginDockResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!pinned) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = dockWidth;
    let pendingWidth = startWidth;
    let frameId: number | null = null;
    const applyWidth = () => {
      frameId = null;
      onDockWidthChange(pendingWidth);
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      pendingWidth = startWidth + startX - moveEvent.clientX;
      if (frameId === null) {
        frameId = window.requestAnimationFrame(applyWidth);
      }
    };
    const finishResize = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        applyWidth();
      }
      document.documentElement.classList.remove("layout-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };
    document.documentElement.classList.add("layout-resizing");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  const selectedChatId = selection?.id ?? null;
  const initialSelectedChatId = initialSelectedChatIdRef.current;
  const chatSelectionQuery = initialSelectedChatId ? `&selection=${encodeURIComponent(initialSelectedChatId)}` : "";
  const chatPath = selectedChatId ? `/chat/?selection=${encodeURIComponent(selectedChatId)}` : "/chat/";
  const chatFrameSrc = `/chat/?embedded=1${chatSelectionQuery}`;

  return (
    <aside
      aria-label="COP Chat"
      className={clsx("messaging-panel embedded-chat-panel", pinned && "pinned")}
      style={{ "--messaging-dock-width": `${dockWidth}px` } as React.CSSProperties}
    >
      {pinned ? (
        <div
          aria-label="Změnit šířku chatu"
          className="messaging-resize-handle"
          onPointerDown={beginDockResize}
          role="separator"
        />
      ) : null}
      <div className="embedded-chat-panel-main">
        <header className="messaging-panel-header embedded-chat-panel-header">
          <div className="chat-panel-title">
            <MessageCircle size={18} />
            <div>
              <strong>Chat</strong>
              <span>Integrovaný COP Chat</span>
            </div>
          </div>
          <div className="messaging-header-actions">
            <a className="icon-button" href={chatPath} rel="noreferrer" target="_blank" title="Otevřít chat samostatně">
              <MonitorUp size={17} />
            </a>
            <button className="icon-button" onClick={onClose} title="Zavřít chat" type="button">
              <X size={18} />
            </button>
          </div>
        </header>
        <iframe
          allow="clipboard-read; clipboard-write; geolocation; microphone; camera"
          className="embedded-chat-frame"
          ref={iframeRef}
          referrerPolicy="same-origin"
          src={chatFrameSrc}
          title="COP Chat"
        />
      </div>
    </aside>
  );
}

function WorkspaceNavigator({
  activeWorkspace,
  chatUnreadCount,
  onChange,
  onOpenMessaging,
  onOpenSettings,
  onStartReport
}: {
  activeWorkspace: WorkspaceModule;
  chatUnreadCount: number;
  onChange: (workspace: WorkspaceModule) => void;
  onOpenMessaging: () => void;
  onOpenSettings: () => void;
  onStartReport: () => void;
}) {
  const modules: WorkspaceModule[] = ["data", "map", "alerts", "sources", "radio", "replay"];
  return (
    <nav className="workspace-nav app-module-rail" aria-label="Situační pracovní plocha">
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
            <span>{workspaceRailLabel(module)}</span>
          </button>
        );
      })}
      <button className="workspace-tab" onClick={onOpenMessaging} title="Otevřít komunikaci" type="button">
        <MessageCircle size={16} />
        <span>Komunikace</span>
        {chatUnreadCount > 0 ? <strong className="nav-unread-badge">{formatUnreadBadge(chatUnreadCount)}</strong> : null}
      </button>
      <button className="workspace-tab" onClick={onStartReport} title="Vložit nové hlášení" type="button">
        <Plus size={16} />
        <span>Nahlásit</span>
      </button>
      <button className="workspace-settings-button" onClick={onOpenSettings} title="Nastavení operátora" type="button">
        <Settings size={16} />
        <span>Nastavení</span>
      </button>
    </nav>
  );
}

function RadioLosControls({
  customProfile,
  gridStepM,
  linkFrom,
  linkTo,
  mode,
  profileId,
  profiles,
  profilesError,
  profilesStatus,
  radiusM,
  result,
  mapPickTarget,
  searchTargets,
  station,
  useCustomProfile,
  onApplyContext,
  onCustomProfileChange,
  onGridStepMChange,
  onLinkFromChange,
  onLinkToChange,
  onModeChange,
  onProfileIdChange,
  onRadiusMChange,
  onRefreshProfiles,
  onRun,
  onSaveCustomProfile,
  onSearchTargetsChange,
  onStartMapPick,
  onStationChange,
  onUseCustomProfileChange
}: {
  customProfile: RadioProfile;
  gridStepM: number;
  linkFrom: RadioPoint;
  linkTo: RadioPoint;
  mode: RadioLosMode;
  profileId: string;
  profiles: RadioProfile[];
  profilesError: string | null;
  profilesStatus: "idle" | "loading" | "loaded" | "error";
  radiusM: number;
  result: RadioLosResult;
  mapPickTarget: RadioPointPickTarget | null;
  searchTargets: RadioPoint[];
  station: RadioPoint;
  useCustomProfile: boolean;
  onApplyContext: (target: RadioPointPickTarget) => void;
  onCustomProfileChange: (profile: RadioProfile) => void;
  onGridStepMChange: (value: number) => void;
  onLinkFromChange: (point: RadioPoint) => void;
  onLinkToChange: (point: RadioPoint) => void;
  onModeChange: (mode: RadioLosMode) => void;
  onProfileIdChange: (profileId: string) => void;
  onRadiusMChange: (value: number) => void;
  onRefreshProfiles: () => void;
  onRun: () => void;
  onSaveCustomProfile: () => void;
  onSearchTargetsChange: (targets: RadioPoint[]) => void;
  onStartMapPick: (target: RadioPointPickTarget) => void;
  onStationChange: (point: RadioPoint) => void;
  onUseCustomProfileChange: (enabled: boolean) => void;
}) {
  const busy = result.status === "loading";
  const target = searchTargets[0] ?? defaultRadioPoint;
  return (
    <div className="workspace-module-card radio-los-panel">
      <PanelTitle icon={<RadioTower size={17} />} title="Radio LoS" />
      <SegmentedControl
        label="Režim"
        options={[
          ["coverage", "Pokrytí"],
          ["link", "Spojení"],
          ["site", "Stanoviště"]
        ]}
        value={mode}
        onChange={(value) => onModeChange(value as RadioLosMode)}
      />

      <div className="radio-profile-picker">
        <label>
          Profil rádia
          <select disabled={useCustomProfile} value={profileId} onChange={(event) => onProfileIdChange(event.target.value)}>
            {profiles.map((profile) => (
              <option key={profile.profileId ?? profile.name} value={profile.profileId ?? profile.name}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <button className="mini-button compact-text" disabled={profilesStatus === "loading"} onClick={onRefreshProfiles} type="button">
          <RefreshCw size={13} />
          Profily
        </button>
      </div>
      {profilesError ? <div className="error-banner compact">{profilesError}</div> : null}
      <label className="toggle-row">
        <input checked={useCustomProfile} onChange={(event) => onUseCustomProfileChange(event.target.checked)} type="checkbox" />
        Vlastní rádio bez citlivých údajů
      </label>
      {useCustomProfile ? (
        <RadioProfileEditor
          profile={customProfile}
          onChange={onCustomProfileChange}
          onSave={onSaveCustomProfile}
        />
      ) : null}

      {mode === "coverage" ? (
        <>
          <RadioPointEditor label="Stanice" point={station} onChange={onStationChange} />
          <div className="module-action-row">
            <button className="mini-button" onClick={() => onApplyContext("station")} type="button">
              <MapPin size={13} />
              Použít polohu
            </button>
            <button className={`mini-button ${mapPickTarget === "station" ? "active" : ""}`} onClick={() => onStartMapPick("station")} type="button">
              <Crosshair size={13} />
              Vybrat v mapě
            </button>
          </div>
          <RadioNumberInput label="Poloměr" suffix="m" value={radiusM} min={100} max={100000} onChange={onRadiusMChange} />
        </>
      ) : null}

      {mode === "link" ? (
        <>
          <RadioPointEditor label="Odkud" point={linkFrom} onChange={onLinkFromChange} />
          <button className="mini-button wide" onClick={() => onApplyContext("from")} type="button">
            <MapPin size={13} />
            Odkud = aktuální poloha/střed mapy
          </button>
          <button className={`mini-button wide ${mapPickTarget === "from" ? "active" : ""}`} onClick={() => onStartMapPick("from")} type="button">
            <Crosshair size={13} />
            Vybrat „odkud“ v mapě
          </button>
          <RadioPointEditor label="Kam" point={linkTo} onChange={onLinkToChange} />
          <button className="mini-button wide" onClick={() => onApplyContext("to")} type="button">
            <Crosshair size={13} />
            Kam = aktuální poloha/střed mapy
          </button>
          <button className={`mini-button wide ${mapPickTarget === "to" ? "active" : ""}`} onClick={() => onStartMapPick("to")} type="button">
            <Crosshair size={13} />
            Vybrat „kam“ v mapě
          </button>
        </>
      ) : null}

      {mode === "site" ? (
        <>
          <RadioPointEditor label="Cíl spojení" point={target} onChange={(point) => onSearchTargetsChange([point])} />
          <button className="mini-button wide" onClick={() => onApplyContext("site-target")} type="button">
            <Crosshair size={13} />
            Cíl = aktuální poloha/střed mapy
          </button>
          <button className={`mini-button wide ${mapPickTarget === "site-target" ? "active" : ""}`} onClick={() => onStartMapPick("site-target")} type="button">
            <Crosshair size={13} />
            Vybrat cíl v mapě
          </button>
          <RadioNumberInput label="Krok mřížky" suffix="m" value={gridStepM} min={50} max={5000} onChange={onGridStepMChange} />
          <p className="radio-los-hint">Prohledává se aktuálně zobrazený výřez mapy.</p>
        </>
      ) : null}

      <button className="mini-button primary-lite wide" disabled={busy} onClick={onRun} type="button">
        <Play size={14} />
        {busy ? "Počítám..." : "Spustit výpočet"}
      </button>
      <p className="radio-los-disclaimer">{radioLosDisclaimer}</p>
    </div>
  );
}

function RadioProfileEditor({ profile, onChange, onSave }: {
  profile: RadioProfile;
  onChange: (profile: RadioProfile) => void;
  onSave: () => void;
}) {
  const update = (patch: Partial<RadioProfile>) => onChange({ ...profile, ...patch });
  return (
    <div className="radio-profile-editor">
      <label>
        Název
        <input value={profile.name} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <RadioNumberInput label="Frekvence" suffix="MHz" value={profile.frequencyMhz} min={1} max={6000} onChange={(frequencyMhz) => update({ frequencyMhz })} />
      <RadioNumberInput label="Výška TX antény" suffix="m" value={profile.antennaHeightM} min={0.1} max={120} onChange={(antennaHeightM) => update({ antennaHeightM })} />
      <RadioNumberInput label="Výška RX antény" suffix="m" value={profile.receiverHeightM} min={0.1} max={120} onChange={(receiverHeightM) => update({ receiverHeightM })} />
      <RadioNumberInput label="Max. poloměr" suffix="m" value={profile.maxRadiusM} min={100} max={100000} onChange={(maxRadiusM) => update({ maxRadiusM })} />
      <button className="mini-button wide" onClick={onSave} type="button">
        <Save size={13} />
        Uložit profil v SIM
      </button>
    </div>
  );
}

function RadioPointEditor({ label, point, onChange }: { label: string; point: RadioPoint; onChange: (point: RadioPoint) => void }) {
  const update = (patch: Partial<RadioPoint>) => onChange({ ...point, ...patch });
  return (
    <div className="radio-point-editor">
      <strong>{label}</strong>
      <RadioNumberInput label="Lon" value={point.lon} min={-180} max={180} step={0.00001} onChange={(lon) => update({ lon })} />
      <RadioNumberInput label="Lat" value={point.lat} min={-90} max={90} step={0.00001} onChange={(lat) => update({ lat })} />
      <RadioNumberInput label="Výška antény" suffix="m" value={point.antennaHeightM ?? point.receiverHeightM ?? 1.5} min={0.1} max={120} onChange={(antennaHeightM) => update({ antennaHeightM, receiverHeightM: antennaHeightM })} />
    </div>
  );
}

function RadioNumberInput({ label, max, min, onChange, step = 1, suffix, value }: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  value: number;
}) {
  return (
    <label className="radio-number-input">
      <span>{label}</span>
      <span>
        <input
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={step}
          type="number"
          value={Number.isFinite(value) ? value : min}
        />
        {suffix ? <em>{suffix}</em> : null}
      </span>
    </label>
  );
}

function RadioLosWorkspaceBoard({ overlay, result, selectedProfile, onClear, onRun }: {
  overlay: RadioLosMapOverlay | null;
  result: RadioLosResult;
  selectedProfile: RadioProfile;
  onClear: () => void;
  onRun: () => void;
}) {
  return (
    <section className="operations-deck radio-operations-deck">
      <div className="source-operations-board radio-result-board">
        <div className="deck-header">
          <PanelTitle icon={<RadioTower size={17} />} title="Radio LoS výsledek" />
          <span>{result.status === "loaded" ? "hotovo" : result.status === "loading" ? "počítám" : "čeká na spuštění"}</span>
        </div>
        <ReadinessRow label="Režim" value={radioLosModeLabel(result.mode)} tone={result.status === "error" ? "warn" : "neutral"} />
        <ReadinessRow label="Profil" value={selectedProfile.name} tone="neutral" />
        {overlay ? <ReadinessRow label="Prvky na mapě" value={String(overlay.features.length)} tone={overlay.features.length > 0 ? "ok" : "warn"} /> : null}
        {result.link ? <RadioLinkSummary link={result.link} /> : null}
        {result.error ? <div className="error-banner">{result.error}</div> : null}
        {result.warnings.length > 0 ? (
          <div className="radio-warning-list">
            {result.warnings.slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}
          </div>
        ) : null}
        <div className="module-action-row">
          <button className="mini-button primary-lite" disabled={result.status === "loading"} onClick={onRun} type="button">
            <Play size={14} />
            Přepočítat
          </button>
          <button className="mini-button" onClick={onClear} type="button">
            <X size={14} />
            Skrýt overlay
          </button>
        </div>
      </div>
      <div className="source-operations-board radio-result-board">
        <PanelTitle icon={<ShieldCheck size={17} />} title="Interpretace" />
        <p className="radio-los-disclaimer">{radioLosDisclaimer}</p>
        <ReadinessRow label="DEM/LoS" value="modelový odhad" tone="neutral" />
        <ReadinessRow label="Budovy/vegetace" value="nezahrnuto" tone="warn" />
        <ReadinessRow label="RF tajné údaje" value="nepřenášet" tone="warn" />
      </div>
    </section>
  );
}

function RadioLinkSummary({ link }: { link: RadioLinkCheckResponse }) {
  return (
    <div className="radio-link-summary">
      <ReadinessRow label="Stav spojení" value={radioLinkStatusLabel(link.linkStatus)} tone={link.linkStatus === "clear" ? "ok" : link.linkStatus === "obstructed" ? "warn" : "neutral"} />
      <ReadinessRow label="Vzdálenost" value={formatMeters(link.distanceM)} tone="neutral" />
      <ReadinessRow label="Azimut" value={link.azimuthDeg !== undefined ? `${Math.round(link.azimuthDeg)}°` : "n/a"} tone="neutral" />
      <ReadinessRow label="Fresnel" value={link.fresnelClearancePct !== undefined ? `${Math.round(link.fresnelClearancePct)} %` : "n/a"} tone={(link.fresnelClearancePct ?? 0) >= 60 ? "ok" : "warn"} />
      <ReadinessRow label="Potřebné zvýšení" value={formatMeters(link.requiredExtraAntennaHeightM)} tone={(link.requiredExtraAntennaHeightM ?? 0) > 0 ? "warn" : "ok"} />
    </div>
  );
}

function MobileBottomNav({
  activeSheet,
  chatUnreadCount,
  messagingOpen,
  settingsOpen,
  sketchOpen,
  onChat,
  onLayers,
  onMap,
  onMenu,
  onReport,
  onSketch
}: {
  activeSheet: MobileSheet;
  chatUnreadCount: number;
  messagingOpen: boolean;
  settingsOpen: boolean;
  sketchOpen: boolean;
  onChat: () => void;
  onLayers: () => void;
  onMap: () => void;
  onMenu: () => void;
  onReport: () => void;
  onSketch: () => void;
}) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobilní navigace">
      <button className={!activeSheet && !messagingOpen && !settingsOpen && !sketchOpen ? "active" : ""} onClick={onMap} type="button">
        <Layers size={18} />
        <span>Mapa</span>
      </button>
      <button className={activeSheet === "layers" ? "active" : ""} onClick={onLayers} type="button">
        <ListFilter size={18} />
        <span>Vrstvy</span>
      </button>
      <button className={sketchOpen ? "active" : ""} onClick={onSketch} type="button">
        <PenLine size={18} />
        <span>Zákres</span>
      </button>
      <button className={messagingOpen ? "active" : ""} onClick={onChat} type="button">
        <MessageCircle size={18} />
        <span>Chat</span>
        {chatUnreadCount > 0 ? <strong className="nav-unread-badge">{formatUnreadBadge(chatUnreadCount)}</strong> : null}
      </button>
      <button className="report" onClick={onReport} type="button">
        <Plus size={19} />
        <span>Nahlásit</span>
      </button>
      <button className={settingsOpen ? "active" : ""} onClick={onMenu} type="button">
        <Settings size={18} />
        <span>Menu</span>
      </button>
    </nav>
  );
}

function MobileSheetSurface({
  children,
  onClose,
  subtitle,
  title
}: {
  children: React.ReactNode;
  onClose: () => void;
  subtitle?: string;
  title: string;
}) {
  const [dragOffset, setDragOffset] = React.useState(0);
  const startYRef = React.useRef<number | null>(null);

  const stopSheetEvent = React.useCallback((event: React.SyntheticEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  const handleGripPointerDown = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startYRef.current = event.clientY;
    setDragOffset(0);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (startYRef.current === null) {
        return;
      }
      moveEvent.preventDefault();
      const nextOffset = Math.max(0, moveEvent.clientY - startYRef.current);
      setDragOffset(Math.min(140, nextOffset));
    };

    const finishDrag = (upEvent: PointerEvent) => {
      const startY = startYRef.current;
      const deltaY = startY === null ? 0 : upEvent.clientY - startY;
      startYRef.current = null;
      setDragOffset(0);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      if (deltaY > 78) {
        onClose();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finishDrag, { once: true });
    window.addEventListener("pointercancel", finishDrag, { once: true });
  }, [onClose]);

  return (
    <div
      className="mobile-sheet-layer"
      onClick={stopSheetEvent}
      onPointerDown={stopSheetEvent}
      onPointerMove={stopSheetEvent}
      onPointerUp={stopSheetEvent}
      onTouchEnd={stopSheetEvent}
      onTouchMove={stopSheetEvent}
      onTouchStart={stopSheetEvent}
    >
      <div className="mobile-sheet-map-shield" aria-hidden="true" />
      <section
        aria-label={title}
        className="mobile-sheet-surface"
        data-testid="mobile-sheet-surface"
        role="dialog"
        style={{ "--mobile-sheet-offset": `${dragOffset}px` } as React.CSSProperties}
      >
        <button
          aria-label="Stáhnout panel dolů"
          className="mobile-sheet-grip"
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onClose();
            }
          }}
          onPointerDown={handleGripPointerDown}
          type="button"
        >
          <span aria-hidden="true" />
        </button>
        <header className="mobile-sheet-header">
          <div>
            <span>{subtitle ?? "Panel"}</span>
            <strong>{title}</strong>
          </div>
          <button aria-label="Zavřít panel" onClick={onClose} type="button">
            <X size={18} />
            <span>Zavřít</span>
          </button>
        </header>
        <div className="mobile-sheet-content">
          {children}
        </div>
      </section>
    </div>
  );
}

function ViewProfilesPanel({
  activeProfileName,
  canSave,
  profiles,
  userScope,
  onApply,
  onSave
}: {
  activeProfileName: string | null;
  canSave: boolean;
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
      {canSave ? (
        <button className="mini-button wide save-profile-button" onClick={onSave} type="button">
          <Settings size={14} />
          Uložit aktuální pohled
        </button>
      ) : (
        <div className="profile-login-gate">
          <span>Ukládání vlastních profilů je dostupné po přihlášení.</span>
          <span className="auth-hint">Přihlášení najdete v horní liště.</span>
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
        <strong>{mode === "OFFLINE" ? "Offline uložený náhled" : "Omezený režim s uloženým náhledem"}</strong>
        <span>
          Uloženo {formatSnapshotAge(state)} · {state.objectCount} objektů · {state.sourceCount} zdrojů
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

function operatingModeLabel(mode: OperatingMode): string {
  if (mode === "ONLINE") {
    return "online";
  }
  if (mode === "OFFLINE") {
    return "offline";
  }
  return "omezeno";
}

function missionModeLabel(mode: OperatingMode, snapshotState: OfflineSnapshotState): string {
  if (snapshotState.kind === "active") {
    return mode === "OFFLINE" ? "offline náhled" : "omezený náhled";
  }
  if (mode === "ONLINE") {
    return "živě";
  }
  return operatingModeLabel(mode);
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
    return health.metrics.backpressureActive ? `aktivní · obnova ${formatRetryMs(health.metrics.recommendedRetryMs)}` : "v pořádku";
  }
  if (telemetry.lastBackpressureAt) {
    return `zaznamenáno ${formatStreamObservation(telemetry.lastBackpressureAt)}`;
  }
  return "v pořádku";
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
  return `změny ${metrics.deltaMessagesTotal} · signál ${metrics.heartbeatMessagesTotal}`;
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
      <PanelTitle icon={<Activity size={17} />} title="Stav zdrojů" />
      {items.length === 0 ? <div className="empty-mini">Stav zdrojů zatím není dostupný.</div> : null}
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
                <dt>Objekty</dt>
                <dd>{item.currentTracks}/{item.totalTracks}</dd>
              </div>
              <div>
                <dt>Události</dt>
                <dd>{item.acceptedEvents}</dd>
              </div>
              <div>
                <dt>Aktualizace</dt>
                <dd>{formatSourceAge(item.lastObservationAgeSeconds)}</dd>
              </div>
              <div>
                <dt>Odezva</dt>
                <dd>{formatLatency(item.lastLatencyMs ?? item.avgLatencyMs)}</dd>
              </div>
            </dl>
            {item.staleTracks > 0 || item.expiredTracks > 0 || item.lowConfidenceTracks > 0 ? (
              <div className="source-health-warnings">
                {item.staleTracks > 0 ? <span>{item.staleTracks} starší data</span> : null}
                {item.expiredTracks > 0 ? <span>{item.expiredTracks} po platnosti</span> : null}
                {item.lowConfidenceTracks > 0 ? <span>{item.lowConfidenceTracks} nízká jistota</span> : null}
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
      <PanelTitle icon={<Activity size={17} />} title="Živé spojení" />
      <ReadinessRow label="Stav služby" value={health?.status ?? "čeká"} tone={streamServerTone(health, telemetry)} />
      <ReadinessRow label="Připojení" value={formatServerClientCount(health, telemetry)} tone={streamServerTone(health, telemetry)} />
      <ReadinessRow label="Datové zprávy" value={formatStreamMessageTotals(health)} tone="neutral" />
      <ReadinessRow label="Poslední změna" value={formatStreamObservation(metrics?.lastDeltaAt ?? null)} tone={metrics?.lastDeltaAt ? "ok" : "neutral"} />
      <ReadinessRow label="Zátěž" value={formatBackpressureState(health, telemetry)} tone={streamServerTone(health, telemetry)} />
      <ReadinessRow label="Chyby zápisu" value={formatStreamWriteErrors(health, telemetry)} tone={streamWriteErrorsTone(health, telemetry)} />
    </div>
  );
}

function SettingsDrawer({
  activeTab,
  alertRadiusKm,
  apiBase,
  aoiRule,
  authConfig,
  authDiagnostics,
  authSession,
  authToken,
  autoRefresh,
  demoScenario,
  demoScenarioBusy,
  demoScenarioError,
  includeSynthetic,
  language,
  mapBasemapMode,
  mapClusterEnabled,
  minConfidence,
  operatorProfile,
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
  webPushBusy,
  webPushState,
  workspaceLayout,
  workspaceSkin,
  onAlertRadiusKmChange,
  onAoiRuleCenterFromMap,
  onAoiRuleCenterFromUserLocation,
  onAoiRuleEnabledChange,
  onAoiRuleRadiusKmChange,
  onAutoRefreshChange,
  onClose,
  onDemoScenarioRefresh,
  onDemoScenarioReset,
  onDemoScenarioSeed,
  onIncludeSyntheticChange,
  onLanguageChange,
  onMapBasemapModeChange,
  onMapClusterEnabledChange,
  onMinConfidenceChange,
  onOperatorProfileChange,
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
  onDisableWebPush,
  onEnableWebPush,
  onWorkspaceSkinChange,
  onWorkspaceTemplateApply,
  onWorkspaceLayoutChange,
  onHelp,
  onLogin,
  onLogout
}: {
  activeTab: SettingsTab;
  alertRadiusKm: number;
  apiBase: string;
  aoiRule: AoiRule | null;
  authConfig: AuthConfig;
  authDiagnostics: AuthDiagnostics;
  authSession: AuthSession;
  authToken: string | undefined;
  autoRefresh: boolean;
  demoScenario: DemoScenarioResponse | null;
  demoScenarioBusy: "loading" | "resetting" | "seeding" | null;
  demoScenarioError: string | null;
  includeSynthetic: boolean;
  language: AppLanguage;
  mapBasemapMode: MapBasemapMode;
  mapClusterEnabled: boolean;
  minConfidence: number;
  operatorProfile: OperatorProfilePreferences;
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
  webPushBusy: boolean;
  webPushState: WebPushUiState;
  workspaceLayout: Required<WorkspaceLayoutPreferences>;
  workspaceSkin: WorkspaceSkin;
  onAlertRadiusKmChange: (value: number) => void;
  onAoiRuleCenterFromMap: () => void;
  onAoiRuleCenterFromUserLocation: () => void;
  onAoiRuleEnabledChange: (value: boolean) => void;
  onAoiRuleRadiusKmChange: (value: number) => void;
  onAutoRefreshChange: (value: boolean) => void;
  onClose: () => void;
  onDemoScenarioRefresh: () => void;
  onDemoScenarioReset: () => void;
  onDemoScenarioSeed: () => void;
  onIncludeSyntheticChange: (value: boolean) => void;
  onLanguageChange: (value: AppLanguage) => void;
  onMapBasemapModeChange: (value: MapBasemapMode) => void;
  onMapClusterEnabledChange: (value: boolean) => void;
  onMinConfidenceChange: (value: number) => void;
  onOperatorProfileChange: (value: OperatorProfilePreferences) => void;
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
  onDisableWebPush: () => void;
  onEnableWebPush: () => void;
  onWorkspaceSkinChange: (value: WorkspaceSkin) => void;
  onWorkspaceTemplateApply: (value: WorkspaceTemplateId) => void;
  onWorkspaceLayoutChange: (value: Partial<WorkspaceLayoutPreferences>) => void;
  onHelp: (section: HelpSection) => void;
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
            ["workspace", "Plocha"],
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
              <p className="settings-help">Civilní a rizikový podklad tlumí detailní OSM mapu. Režim Hranice automaticky přidá správní hranice ze SIM a použije výrazně zjednodušený podklad.</p>
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
              <PanelTitle icon={<RefreshCw size={17} />} title="Aktualizace dat" />
              <p className="settings-help">
                Aplikace se průběžně obnovuje sama. Záložní aktualizace pomáhá po ztrátě spojení, po návratu do prohlížeče a u méně dynamických vrstev.
              </p>
              <p className="settings-help">
                Při výpadku spojení zůstane dostupný poslední uložený náhled mapy a povolených vrstev.
              </p>
              <label className="toggle-row">
                <input type="checkbox" checked={autoRefresh} onChange={(event) => onAutoRefreshChange(event.target.checked)} />
                Povolit záložní aktualizaci
              </label>
              <SegmentedControl
                label="Interval aktualizace"
                options={REFRESH_OPTIONS.map((option) => [String(option), `${option}s`])}
                value={String(refreshSeconds)}
                onChange={(value) => onRefreshSecondsChange(normalizeRefreshSeconds(Number(value)))}
              />
              <label className="toggle-row">
                <input type="checkbox" checked={includeSynthetic} onChange={(event) => onIncludeSyntheticChange(event.target.checked)} />
                Zobrazit cvičná data
              </label>
              <PocDemoScenarioPanel
                busy={demoScenarioBusy}
                error={demoScenarioError}
                scenario={demoScenario}
                onRefresh={onDemoScenarioRefresh}
                onReset={onDemoScenarioReset}
                onSeed={onDemoScenarioSeed}
              />
              <label className="range-label">
                Minimální jistota dat
                <input type="range" min="0" max="1" step="0.05" value={minConfidence} onChange={(event) => onMinConfidenceChange(Number(event.target.value))} />
                <span>{Math.round(minConfidence * 100)} %</span>
              </label>
            </section>
          ) : null}

          {activeTab === "workspace" ? (
            <section className="settings-section">
              <div className="settings-title-row">
                <PanelTitle icon={<PanelLeftClose size={17} />} title="Plocha operátora" />
                <HelpHint label="Jak nastavit pracovní plochu" onOpen={() => onHelp("layout")} />
              </div>
              <p className="settings-help">
                Panely lze zmenšit, sbalit do ikony nebo úplně skrýt. Nastavení se ukládá do profilu přihlášeného uživatele a na tomto zařízení funguje i v offline režimu.
              </p>
              <WorkspaceSkinPicker value={workspaceSkin} onChange={onWorkspaceSkinChange} onApplyTemplate={onWorkspaceTemplateApply} />
              <WorkspaceLayoutEditor layout={workspaceLayout} onChange={onWorkspaceLayoutChange} onHelp={() => onHelp("layout")} />
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
              <PanelTitle icon={<Languages size={17} />} title="Jazyk aplikace" />
              <SegmentedControl
                label="Jazyk"
                options={appLanguageOptions}
                value={language}
                onChange={(value) => onLanguageChange(value as AppLanguage)}
              />
              <p className="settings-help">Jazyk se ukládá do profilu uživatele. Zároveň se podle něj dotazuje katalog vrstev a vyhledávání míst.</p>
              <PanelTitle icon={<UserCircle size={17} />} title="Přihlášení" />
              <ReadinessRow label="Stav" value={authSession.status === "authenticated" ? "přihlášeno" : "veřejný režim"} tone={authSession.status === "authenticated" ? "ok" : "neutral"} />
              <ReadinessRow label="Uživatel" value={authSession.profile?.name ?? "nepřihlášen"} tone="neutral" />
              <ReadinessRow label="Uložení profilu" value={profileSyncLabel(profileSyncStatus)} tone={profileSyncTone(profileSyncStatus)} />
              <ProfileEditor
                profile={operatorProfile}
                session={authSession}
                onChange={onOperatorProfileChange}
                onHelp={() => onHelp("profile")}
              />
              {authConfig.publicReadEnabled && authSession.status !== "authenticated" ? (
                <div className="empty-mini">Mapa a veřejné vrstvy jsou dostupné bez přihlášení. Uživatelský profil, hlášení, potvrzení výstrah a AI asistent vyžadují účet.</div>
              ) : null}
              {isOidcEnabled(authConfig) ? (
                authSession.status === "authenticated" ? (
                  <div className="settings-button-row">
                    <button className="primary-button secondary" onClick={onLogout} type="button">
                      <LogOut size={16} />
                      Odhlásit
                    </button>
                  </div>
                ) : (
                  <div className="settings-button-row">
                    <button className="primary-button" onClick={onLogin} type="button">
                      <LogIn size={16} />
                      Přihlásit
                    </button>
                  </div>
                )
              ) : (
                <div className="empty-mini">Přihlášení není v této konfiguraci zapnuté. Aplikace běží v laboratorním režimu.</div>
              )}
              {profileSyncError ? <div className="error-banner">Profil: {profileSyncError}</div> : null}
              {authSession.error ? <div className="error-banner">Přihlášení: {authSession.error}</div> : null}
              <WebPushSettingsPanel
                authenticated={authSession.status === "authenticated"}
                busy={webPushBusy}
                state={webPushState}
                onDisable={onDisableWebPush}
                onEnable={onEnableWebPush}
              />
              <MobileDevicePairingPanel
                apiBase={apiBase}
                authenticated={authSession.status === "authenticated"}
                authToken={authToken}
              />
              <AuthDiagnosticsPanel diagnostics={authDiagnostics} session={authSession} />
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function PocDemoScenarioPanel({
  busy,
  error,
  onRefresh,
  onReset,
  onSeed,
  scenario
}: {
  busy: "loading" | "resetting" | "seeding" | null;
  error: string | null;
  onRefresh: () => void;
  onReset: () => void;
  onSeed: () => void;
  scenario: DemoScenarioResponse | null;
}) {
  const summary = scenario?.scenario.summary;
  const disabled = busy !== null;
  const status = scenario?.scenario.status ?? "empty";
  const generatedAt = scenario?.generatedAt ? new Date(scenario.generatedAt) : null;
  const generatedAtLabel = generatedAt && Number.isFinite(generatedAt.getTime())
    ? generatedAt.toLocaleString("cs-CZ", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit" })
    : null;
  return (
    <div className="settings-subsection poc-demo-panel">
      <div className="settings-title-row">
        <PanelTitle icon={<Database size={17} />} title="PoC demo data" />
        <button className="mini-button" disabled={disabled} onClick={onRefresh} type="button">
          <RefreshCw size={14} />
          {busy === "loading" ? "Kontroluji..." : "Obnovit"}
        </button>
      </div>
      <p className="settings-help">
        Řízený scénář připraví ukázkové skupiny, hlášení a zákresy pro PoC průchod. Reset smaže pouze data označená tímto demo scénářem.
      </p>
      <ReadinessRow label="Scénář" value={scenario?.scenario.label ?? "Povodeň - Středočeský kraj"} tone="neutral" />
      <ReadinessRow label="Stav" value={status === "ready" ? "připraveno" : "prázdné"} tone={status === "ready" ? "ok" : "neutral"} />
      <ReadinessRow label="Skupiny" value={String(summary?.groupCount ?? 0)} tone={(summary?.groupCount ?? 0) > 0 ? "ok" : "neutral"} />
      <ReadinessRow label="Hlášení" value={String(summary?.reportCount ?? 0)} tone={(summary?.reportCount ?? 0) > 0 ? "ok" : "neutral"} />
      <ReadinessRow label="Zákresy" value={String(summary?.drawingCount ?? 0)} tone={(summary?.drawingCount ?? 0) > 0 ? "ok" : "neutral"} />
      {generatedAtLabel ? <ReadinessRow label="Kontrola" value={generatedAtLabel} tone="neutral" /> : null}
      {error ? <div className="error-banner">PoC demo: {error}</div> : null}
      <div className="settings-button-row">
        <button className="primary-button secondary" disabled={disabled} onClick={onSeed} type="button">
          <Play size={16} />
          {busy === "seeding" ? "Připravuji..." : "Připravit PoC data"}
        </button>
        <button className="mini-button danger" disabled={disabled} onClick={onReset} type="button">
          <Trash2 size={15} />
          {busy === "resetting" ? "Čistím..." : "Vyčistit demo"}
        </button>
      </div>
    </div>
  );
}

function WebPushSettingsPanel({
  authenticated,
  busy,
  onDisable,
  onEnable,
  state
}: {
  authenticated: boolean;
  busy: boolean;
  onDisable: () => void;
  onEnable: () => void;
  state: WebPushUiState;
}) {
  const canEnable = authenticated && state.enabled && state.status !== "unsupported" && state.status !== "permission-denied";
  const buttonLabel = state.registered ? "Vypnout v tomto prohlížeči" : "Zapnout v tomto prohlížeči";

  return (
    <div className="settings-subsection">
      <PanelTitle icon={<BellRing size={17} />} title="Webové notifikace" />
      <p className="settings-help">
        Prohlížeč může přijímat výstrahy a zprávy i mimo otevřené okno aplikace. COP registruje jen tento prohlížeč; doručení zajišťuje CSM Messaging.
      </p>
      <ReadinessRow label="Stav" value={webPushStatusLabel(state)} tone={webPushStatusTone(state)} />
      <ReadinessRow label="Oprávnění prohlížeče" value={webPushPermissionLabel(state.permission)} tone={state.permission === "granted" ? "ok" : state.permission === "denied" ? "warn" : "neutral"} />
      {state.deviceId ? <ReadinessRow label="Zařízení" value="registrovaný prohlížeč" tone={state.registered ? "ok" : "neutral"} /> : null}
      {!authenticated ? <div className="empty-mini">Webové notifikace vyžadují přihlášení. Mapa zůstává dostupná i bez účtu.</div> : null}
      {state.warnings.length > 0 ? (
        <div className="empty-mini">{state.warnings.slice(0, 2).join(" ")}</div>
      ) : null}
      <div className="settings-button-row">
        <button
          className={state.registered ? "primary-button secondary" : "primary-button"}
          disabled={busy || (!state.registered && !canEnable)}
          onClick={state.registered ? onDisable : onEnable}
          type="button"
        >
          <BellRing size={16} />
          {busy ? "Pracuji..." : buttonLabel}
        </button>
      </div>
    </div>
  );
}

function MobileDevicePairingPanel({
  apiBase,
  authenticated,
  authToken
}: {
  apiBase: string;
  authenticated: boolean;
  authToken: string | undefined;
}) {
  const [busy, setBusy] = React.useState<"confirming" | "loading" | "pairing" | "revoking" | null>(null);
  const [copyState, setCopyState] = React.useState<"copied" | "idle">("idle");
  const [devices, setDevices] = React.useState<MobileDeviceRecord[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [session, setSession] = React.useState<MobilePairingSessionResponse | null>(null);

  const loadDevices = React.useCallback(async () => {
    if (!authenticated || !authToken) {
      setDevices([]);
      return;
    }
    setBusy((current) => current ?? "loading");
    setError(null);
    try {
      const response = await fetchMobileDevices(apiBase, authToken);
      setDevices(response.devices);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Zařízení se nepodařilo načíst.");
    } finally {
      setBusy((current) => current === "loading" ? null : current);
    }
  }, [apiBase, authToken, authenticated]);

  React.useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  React.useEffect(() => {
    let cancelled = false;
    setQrDataUrl(null);
    const universalLink = session?.pairing.links.universalLink;
    if (!universalLink) {
      return () => {
        cancelled = true;
      };
    }
    QRCode.toDataURL(universalLink, { margin: 1, scale: 6, width: 192 })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session?.pairing.links.universalLink]);

  React.useEffect(() => {
    if (!authenticated || !authToken || !session || !["pending", "claimed"].includes(session.pairing.status)) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchMobilePairingSession(apiBase, authToken, session.pairing.code);
        if (!cancelled) {
          setSession(next);
          if (next.pairing.status === "confirmed") {
            await loadDevices();
          }
        }
      } catch {
        // Polling is opportunistic; explicit actions surface errors to the user.
      }
    };
    const interval = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [apiBase, authToken, authenticated, loadDevices, session]);

  const createSession = async () => {
    if (!authToken) {
      return;
    }
    setBusy("pairing");
    setError(null);
    setCopyState("idle");
    try {
      setSession(await createMobilePairingSession(apiBase, authToken));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Párování se nepodařilo zahájit.");
    } finally {
      setBusy(null);
    }
  };

  const confirmSession = async () => {
    if (!authToken || !session) {
      return;
    }
    setBusy("confirming");
    setError(null);
    try {
      const confirmed = await confirmMobilePairingSession(apiBase, authToken, session.pairing.code);
      setSession(confirmed);
      await loadDevices();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Zařízení se nepodařilo potvrdit.");
    } finally {
      setBusy(null);
    }
  };

  const copyPairingLink = async () => {
    const link = session?.pairing.links.universalLink;
    if (!link || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(link);
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1800);
  };

  const revokeDevice = async (deviceId: string) => {
    if (!authToken) {
      return;
    }
    setBusy("revoking");
    setError(null);
    try {
      await revokeMobileDevice(apiBase, authToken, deviceId);
      await loadDevices();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Zařízení se nepodařilo odebrat.");
    } finally {
      setBusy(null);
    }
  };

  const pairingStatus = session?.pairing.status;
  const claimedDevice = session?.pairing.claimedDevice;

  return (
    <div className="settings-subsection mobile-device-panel">
      <div className="settings-title-row">
        <PanelTitle icon={<Smartphone size={17} />} title="Mobilní zařízení" />
        <button className="mini-button" disabled={!authenticated || busy === "pairing"} onClick={() => void createSession()} type="button">
          <QrCode size={14} />
          {busy === "pairing" ? "Vytvářím..." : "Spárovat"}
        </button>
      </div>
      <p className="settings-help">
        Spárování CSM Messenger používá krátkodobý kód. QR ani odkaz neobsahuje přístupový token, recovery key ani Matrix room keys.
      </p>
      {!authenticated ? <div className="empty-mini">Párování iPhonu/iPadu vyžaduje přihlášení stejným COP účtem jako v mobilní aplikaci.</div> : null}
      {error ? <div className="error-banner">Mobilní zařízení: {error}</div> : null}
      {session ? (
        <div className="mobile-pairing-card">
          <div className="mobile-pairing-head">
            <div>
              <strong>{mobilePairingStatusLabel(pairingStatus)}</strong>
              <span>Platnost do {formatMobileDate(session.pairing.expiresAt)}</span>
            </div>
            <span className={`mobile-device-status ${mobilePairingStatusTone(pairingStatus)}`}>{pairingStatus}</span>
          </div>
          <div className="mobile-pairing-layout">
            <div className="mobile-pairing-qr">
              {qrDataUrl ? <img alt="QR kód pro spárování CSM Messenger" src={qrDataUrl} /> : <QrCode size={56} />}
            </div>
            <div className="mobile-pairing-content">
              <code className="mobile-pairing-code">{session.pairing.code}</code>
              <div className="mobile-pairing-links">
                <a className="mini-button" href={session.pairing.links.customSchemeUrl}>
                  <ExternalLink size={14} />
                  Otevřít aplikaci
                </a>
                <button className="mini-button" onClick={() => void copyPairingLink()} type="button">
                  <Copy size={14} />
                  {copyState === "copied" ? "Zkopírováno" : "Kopírovat link"}
                </button>
              </div>
              {pairingStatus === "pending" ? (
                <div className="empty-mini">Čekám, až se odkaz otevře v CSM Messengeru a mobil se přihlásí stejným účtem.</div>
              ) : null}
              {claimedDevice ? (
                <div className="mobile-device-claim">
                  <ReadinessRow label="Zařízení" value={mobileDeviceTitle(claimedDevice)} tone="ok" />
                  <ReadinessRow label="Aplikace" value={mobileDeviceBuildLabel(claimedDevice)} tone="neutral" />
                  <ReadinessRow label="Platforma" value={mobileDevicePlatformLabel(claimedDevice.platform)} tone="neutral" />
                  <ReadinessRow label="Claim" value={session.pairing.claimedAt ? formatMobileDate(session.pairing.claimedAt) : "čeká"} tone="neutral" />
                  {claimedDevice.capabilities?.length ? <ReadinessRow label="Schopnosti" value={claimedDevice.capabilities.join(", ")} tone="neutral" /> : null}
                  {pairingStatus === "claimed" ? (
                    <button className="primary-button" disabled={busy === "confirming"} onClick={() => void confirmSession()} type="button">
                      <CheckCircle2 size={16} />
                      {busy === "confirming" ? "Potvrzuji..." : "Potvrdit zařízení"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="mobile-device-list">
        <div className="mobile-device-list-header">
          <span>Spárovaná zařízení</span>
          <button className="mini-button" disabled={!authenticated || busy === "loading"} onClick={() => void loadDevices()} type="button">
            <RefreshCw size={14} />
            Obnovit
          </button>
        </div>
        {devices.length === 0 ? (
          <div className="empty-mini">{authenticated ? "Zatím není spárované žádné mobilní zařízení." : "Seznam zařízení je dostupný po přihlášení."}</div>
        ) : devices.map((device) => (
          <div className="mobile-device-row" key={device.deviceId}>
            <div>
              <strong>{mobileDeviceTitle(device)}</strong>
              <span>{mobileDeviceBuildLabel(device)} · posledně {formatMobileDate(device.lastSeenAt)}</span>
              {device.capabilities.length ? <small>{device.capabilities.join(", ")}</small> : null}
            </div>
            <div className="mobile-device-actions">
              <span className={`mobile-device-status ${device.status === "paired" ? "ok" : "warn"}`}>{device.status === "paired" ? "aktivní" : "odebrané"}</span>
              <button
                className="mini-button danger"
                disabled={device.status !== "paired" || busy === "revoking"}
                onClick={() => void revokeDevice(device.deviceId)}
                type="button"
              >
                <Trash2 size={14} />
                Odebrat
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type MobileDeviceDisplay = MobileDeviceRecord | NonNullable<MobilePairingSessionResponse["pairing"]["claimedDevice"]>;

function mobilePairingStatusLabel(status: MobilePairingSessionResponse["pairing"]["status"] | undefined): string {
  switch (status) {
    case "claimed":
      return "Mobil čeká na potvrzení";
    case "confirmed":
      return "Zařízení spárováno";
    case "expired":
      return "Kód vypršel";
    case "revoked":
      return "Párování zrušeno";
    case "pending":
    default:
      return "Čeká na mobil";
  }
}

function mobilePairingStatusTone(status: MobilePairingSessionResponse["pairing"]["status"] | undefined): "neutral" | "ok" | "warn" {
  if (status === "claimed" || status === "confirmed") {
    return "ok";
  }
  if (status === "expired" || status === "revoked") {
    return "warn";
  }
  return "neutral";
}

function mobileDevicePlatformLabel(platform: MobileDeviceDisplay["platform"]): string {
  return platform === "ipados" ? "iPadOS" : "iOS";
}

function mobileDeviceTitle(device: MobileDeviceDisplay): string {
  return device.deviceModel
    ? `${device.deviceModel} · ${mobileDevicePlatformLabel(device.platform)}`
    : mobileDevicePlatformLabel(device.platform);
}

function mobileDeviceBuildLabel(device: MobileDeviceDisplay): string {
  return [
    `CSM ${device.appVersion}`,
    device.buildNumber ? `build ${device.buildNumber}` : null,
    device.osVersion ? `${mobileDevicePlatformLabel(device.platform)} ${device.osVersion}` : null
  ].filter(Boolean).join(" · ");
}

function formatMobileDate(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "n/a";
  }
  return date.toLocaleString("cs-CZ", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  });
}

function AuthDiagnosticsPanel({ diagnostics, session }: { diagnostics: AuthDiagnostics; session: AuthSession }) {
  const lastRefresh = [...diagnostics.events].reverse().find((event) =>
    event.type === "refresh_succeeded" || event.type === "refresh_failed" || event.type === "refresh_started"
  );
  const lastAccountChange = [...diagnostics.events].reverse().find((event) => event.type === "storage_changed");
  const currentStorage = diagnostics.current.storage;
  const currentExpiresAt = session.expiresAt ?? diagnostics.current.expiresAt;
  const hasRefreshToken = Boolean(session.refreshToken || diagnostics.current.hasRefreshToken);
  const eventItems = [...diagnostics.events].reverse().slice(0, 8);

  return (
    <div className="settings-subsection auth-diagnostics-panel">
      <PanelTitle icon={<ShieldCheck size={17} />} title="Kontrola přihlášení" />
      <p className="settings-help">
        Slouží k ověření, jestli relaci ukončila expirace, neúspěšná obnova, ruční odhlášení nebo změna účtu v jiném okně. Diagnostika neukládá přístupové ani obnovovací tokeny.
      </p>
      <ReadinessRow
        label="Aktuální relace"
        value={authDiagnosticSessionLabel(session)}
        tone={session.status === "authenticated" ? "ok" : session.status === "error" ? "warn" : "neutral"}
      />
      <ReadinessRow
        label="Uložení relace"
        value={authDiagnosticStorageLabel(currentStorage)}
        tone={currentStorage === "none" ? "neutral" : "ok"}
      />
      <ReadinessRow
        label="Platnost"
        value={formatAuthDiagnosticExpiry(currentExpiresAt)}
        tone={authDiagnosticExpiryTone(currentExpiresAt)}
      />
      <ReadinessRow
        label="Obnova relace"
        value={hasRefreshToken ? "připravená" : "není k dispozici"}
        tone={hasRefreshToken ? "ok" : "warn"}
      />
      {lastRefresh ? (
        <ReadinessRow
          label="Poslední obnova"
          value={authDiagnosticEventLabel(lastRefresh)}
          tone={lastRefresh.type === "refresh_failed" ? "warn" : lastRefresh.type === "refresh_succeeded" ? "ok" : "neutral"}
        />
      ) : null}
      {lastAccountChange ? (
        <ReadinessRow
          label="Jiné okno"
          value={lastAccountChange.detail ?? authDiagnosticEventLabel(lastAccountChange)}
          tone="warn"
        />
      ) : null}
      <details className="auth-diagnostics-events">
        <summary>Poslední události přihlášení</summary>
        {eventItems.length > 0 ? (
          <div className="auth-diagnostics-event-list">
            {eventItems.map((event) => (
              <div className="auth-diagnostics-event" key={`${event.at}-${event.type}-${event.detail ?? ""}`}>
                <span>{formatShortDateTime(event.at)}</span>
                <strong>{authDiagnosticEventLabel(event)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-mini">Zatím nejsou uložené žádné události přihlášení.</div>
        )}
      </details>
    </div>
  );
}

function authDiagnosticSessionLabel(session: AuthSession): string {
  if (session.status === "authenticated") {
    return session.profile?.name ?? session.profile?.username ?? "přihlášeno";
  }
  if (session.status === "authenticating") {
    return "ověřuji";
  }
  if (session.status === "error") {
    return "chyba přihlášení";
  }
  if (session.status === "lab") {
    return "laboratorní režim";
  }
  return "veřejný režim";
}

function authDiagnosticStorageLabel(storage: AuthDiagnostics["current"]["storage"]): string {
  if (storage === "localStorage") {
    return "trvalé v prohlížeči";
  }
  if (storage === "sessionStorage") {
    return "jen aktuální karta";
  }
  return "není uložená";
}

function authDiagnosticExpiryTone(expiresAt: number | undefined): "ok" | "warn" | "neutral" {
  if (!expiresAt) {
    return "neutral";
  }
  return expiresAt > Date.now() + 60_000 ? "ok" : "warn";
}

function formatAuthDiagnosticExpiry(expiresAt: number | undefined): string {
  if (!expiresAt) {
    return "není dostupná";
  }
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    return `vypršela ${formatShortDateTime(new Date(expiresAt).toISOString())}`;
  }
  const remainingMinutes = Math.max(1, Math.round(remainingMs / 60_000));
  return `${remainingMinutes} min · ${formatShortDateTime(new Date(expiresAt).toISOString())}`;
}

function authDiagnosticEventLabel(event: AuthDiagnostics["events"][number]): string {
  const detail = event.detail ? ` · ${event.detail}` : "";
  switch (event.type) {
    case "callback_error":
      return `chyba návratu z přihlášení${detail}`;
    case "login_succeeded":
      return "přihlášení proběhlo";
    case "manual_logout":
      return "ruční odhlášení";
    case "refresh_failed":
      return `obnova relace selhala${detail}`;
    case "refresh_started":
      return "obnova relace zahájena";
    case "refresh_succeeded":
      return "obnova relace proběhla";
    case "session_cleared":
      return "relace byla odstraněna";
    case "session_expired":
      return "uložená relace expirovala";
    case "session_missing":
      return "relace není uložená";
    case "session_persisted":
      return "relace byla uložena";
    case "session_restored":
      return "relace byla obnovena";
    case "storage_changed":
      return `změna účtu v jiném okně${detail}`;
    case "storage_write_failed":
      return "prohlížeč odmítl uložit relaci";
  }
}

function normalizeWorkspaceLayout(value: WorkspaceLayoutPreferences | undefined): Required<WorkspaceLayoutPreferences> {
  return {
    contextRailVisible: value?.contextRailVisible ?? defaultWorkspaceLayout.contextRailVisible,
    leftPanelMode: normalizeWorkspacePanelMode(value?.leftPanelMode, defaultWorkspaceLayout.leftPanelMode),
    leftPanelWidth: clamp(value?.leftPanelWidth ?? defaultWorkspaceLayout.leftPanelWidth, workspaceLeftWidthRange.min, workspaceLeftWidthRange.max),
    rightPanelMode: normalizeWorkspacePanelMode(value?.rightPanelMode, defaultWorkspaceLayout.rightPanelMode),
    rightPanelWidth: clamp(value?.rightPanelWidth ?? defaultWorkspaceLayout.rightPanelWidth, workspaceRightWidthRange.min, workspaceRightWidthRange.max),
    statusbarVisible: value?.statusbarVisible ?? defaultWorkspaceLayout.statusbarVisible
  };
}

function normalizeWorkspacePanelMode(value: WorkspacePanelMode | undefined, fallback: WorkspacePanelMode): WorkspacePanelMode {
  return value === "open" || value === "collapsed" || value === "hidden" ? value : fallback;
}

function normalizeWorkspaceSkin(value: WorkspaceSkin | undefined): WorkspaceSkin {
  return value === "civil" || value === "operations" || value === "field" ? value : "operations";
}

function workspaceTemplatePreferences(templateId: WorkspaceTemplateId): {
  mapBasemapMode: MapBasemapMode;
  mapClusterEnabled: boolean;
  publicFlightSymbolMode: PublicFlightSymbolMode;
  showAlertAreas: boolean;
  workspaceLayout: Required<WorkspaceLayoutPreferences>;
  workspaceSkin: WorkspaceSkin;
} {
  if (templateId === "civil") {
    return {
      mapBasemapMode: "civil",
      mapClusterEnabled: true,
      publicFlightSymbolMode: "civil",
      showAlertAreas: true,
      workspaceLayout: {
        contextRailVisible: true,
        leftPanelMode: "open",
        leftPanelWidth: 320,
        rightPanelMode: "collapsed",
        rightPanelWidth: 360,
        statusbarVisible: true
      },
      workspaceSkin: "civil"
    };
  }
  if (templateId === "field") {
    return {
      mapBasemapMode: "risk",
      mapClusterEnabled: true,
      publicFlightSymbolMode: "civil",
      showAlertAreas: true,
      workspaceLayout: {
        contextRailVisible: false,
        leftPanelMode: "collapsed",
        leftPanelWidth: 280,
        rightPanelMode: "hidden",
        rightPanelWidth: 340,
        statusbarVisible: false
      },
      workspaceSkin: "field"
    };
  }
  return {
    mapBasemapMode: "dark",
    mapClusterEnabled: false,
    publicFlightSymbolMode: "standard",
    showAlertAreas: true,
    workspaceLayout: defaultWorkspaceLayout,
    workspaceSkin: "operations"
  };
}

function initialOperatorProfile(_session: AuthSession, savedProfile: OperatorProfilePreferences | undefined): OperatorProfilePreferences {
  return savedProfile ?? {};
}

function mergeHydratedUserPreferences(
  serverPreferences: UserPreferences,
  localPreferences: UserPreferences,
  fallbackPreferences: UserPreferences
): UserPreferences {
  const hasServerPreferences = Object.keys(serverPreferences).length > 0;
  const hasLocalPreferences = Object.keys(localPreferences).length > 0;
  const basePreferences = hasServerPreferences
    ? serverPreferences
    : hasLocalPreferences
      ? localPreferences
      : fallbackPreferences;
  const operatorProfile = mergeOperatorProfilePreferences(
    serverPreferences.operatorProfile,
    localPreferences.operatorProfile ?? fallbackPreferences.operatorProfile
  );

  return {
    ...basePreferences,
    ...(operatorProfile ? { operatorProfile } : {})
  };
}

function mergeOperatorProfilePreferences(
  serverProfile: OperatorProfilePreferences | undefined,
  localProfile: OperatorProfilePreferences | undefined
): OperatorProfilePreferences | undefined {
  if (!serverProfile && !localProfile) {
    return undefined;
  }
  return {
    ...(localProfile ?? {}),
    ...(serverProfile ?? {}),
    avatarDataUrl: serverProfile?.avatarDataUrl ?? localProfile?.avatarDataUrl,
    contactNote: serverProfile?.contactNote ?? localProfile?.contactNote,
    displayName: serverProfile?.displayName ?? localProfile?.displayName,
    email: serverProfile?.email ?? localProfile?.email,
    organization: serverProfile?.organization ?? localProfile?.organization,
    phone: serverProfile?.phone ?? localProfile?.phone,
    publicContact: serverProfile?.publicContact ?? localProfile?.publicContact,
    role: serverProfile?.role ?? localProfile?.role
  };
}

function sameUserPreferences(left: UserPreferences, right: UserPreferences): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeOperatorProfile(session: AuthSession, profile: OperatorProfilePreferences): OperatorProfilePreferences {
  const authProfile = session.status === "authenticated" ? session.profile : undefined;
  return {
    displayName: profile.displayName ?? authProfile?.name ?? "",
    email: profile.email ?? authProfile?.email ?? "",
    ...profile
  };
}

function operatorInitials(profile: OperatorProfilePreferences): string {
  const source = profile.displayName || profile.email || "CSM";
  const parts = source.split(/[\s.@_-]+/u).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "CS";
}

function OperatorAvatar({ profile, size = "normal" }: { profile: OperatorProfilePreferences; size?: "normal" | "small" }) {
  return (
    <span className={`operator-avatar ${size}`} aria-hidden="true">
      {profile.avatarDataUrl ? <img alt="" src={profile.avatarDataUrl} /> : <strong>{operatorInitials(profile)}</strong>}
    </span>
  );
}

function CollapsedPanelRail({ icon, label, onExpand }: { icon: React.ReactNode; label: string; onExpand: () => void }) {
  return (
    <div className="collapsed-panel-rail">
      {icon}
      <span>{label}</span>
      <button className="icon-button collapsed-panel-expand" onClick={onExpand} title="Rozbalit panel" type="button">
        <ChevronDown size={15} />
        <span>Rozbalit</span>
      </button>
    </div>
  );
}

function WorkspaceLayoutControls({
  layout,
  onChange
}: {
  layout: Required<WorkspaceLayoutPreferences>;
  onChange: (value: Partial<WorkspaceLayoutPreferences>) => void;
}) {
  return (
    <div className="workspace-layout-toolbar" aria-label="Nastavení pracovní plochy">
      <button
        className={layout.leftPanelMode === "hidden" ? "" : "active"}
        onClick={() => onChange({ leftPanelMode: layout.leftPanelMode === "hidden" ? "open" : "hidden" })}
        title={layout.leftPanelMode === "hidden" ? "Zobrazit levý panel" : "Skrýt levý panel"}
        type="button"
      >
        <PanelLeftClose size={15} />
        Vrstvy
      </button>
      <button
        className={layout.rightPanelMode === "hidden" ? "" : "active"}
        onClick={() => onChange({ rightPanelMode: layout.rightPanelMode === "hidden" ? "open" : "hidden" })}
        title={layout.rightPanelMode === "hidden" ? "Zobrazit detail" : "Skrýt detail"}
        type="button"
      >
        <PanelRightClose size={15} />
        Detail
      </button>
    </div>
  );
}

function WorkspaceSkinPicker({
  value,
  onApplyTemplate,
  onChange
}: {
  value: WorkspaceSkin;
  onApplyTemplate: (value: WorkspaceTemplateId) => void;
  onChange: (value: WorkspaceSkin) => void;
}) {
  return (
    <div className="workspace-skin-editor">
      <SegmentedControl
        label="Skin aplikace"
        options={workspaceSkinOptions}
        value={value}
        onChange={(nextValue) => onChange(nextValue as WorkspaceSkin)}
      />
      <div className="workspace-template-grid" aria-label="Šablony pracovní plochy">
        {workspaceTemplateCards.map((template) => (
          <button
            className={`workspace-template-card ${value === template.id ? "active" : ""}`}
            key={template.id}
            onClick={() => onApplyTemplate(template.id)}
            type="button"
          >
            <span>{template.tone}</span>
            <strong>{template.title}</strong>
            <small>{template.description}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceLayoutEditor({
  layout,
  onChange,
  onHelp
}: {
  layout: Required<WorkspaceLayoutPreferences>;
  onChange: (value: Partial<WorkspaceLayoutPreferences>) => void;
  onHelp: () => void;
}) {
  return (
    <div className="workspace-layout-editor">
      <SegmentedControl
        label="Levý panel"
        options={workspacePanelModeOptions}
        value={layout.leftPanelMode}
        onChange={(value) => onChange({ leftPanelMode: value as WorkspacePanelMode })}
      />
      <label className="range-label">
        Šířka levého panelu
        <input
          disabled={layout.leftPanelMode !== "open"}
          max={workspaceLeftWidthRange.max}
          min={workspaceLeftWidthRange.min}
          onChange={(event) => onChange({ leftPanelWidth: Number(event.target.value) })}
          step="10"
          type="range"
          value={layout.leftPanelWidth}
        />
        <span>{layout.leftPanelWidth}px</span>
      </label>
      <SegmentedControl
        label="Pravý panel"
        options={workspacePanelModeOptions}
        value={layout.rightPanelMode}
        onChange={(value) => onChange({ rightPanelMode: value as WorkspacePanelMode })}
      />
      <label className="range-label">
        Šířka pravého panelu
        <input
          disabled={layout.rightPanelMode !== "open"}
          max={workspaceRightWidthRange.max}
          min={workspaceRightWidthRange.min}
          onChange={(event) => onChange({ rightPanelWidth: Number(event.target.value) })}
          step="10"
          type="range"
          value={layout.rightPanelWidth}
        />
        <span>{layout.rightPanelWidth}px</span>
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={layout.statusbarVisible} onChange={(event) => onChange({ statusbarVisible: event.target.checked })} />
        Dolní stavový řádek
      </label>
      <div className="settings-button-row">
        <button className="mini-button" onClick={() => onChange(defaultWorkspaceLayout)} type="button">
          <RefreshCw size={14} />
          Výchozí rozložení
        </button>
        <button className="mini-button" onClick={onHelp} type="button">
          <HelpCircle size={14} />
          Nápověda
        </button>
      </div>
    </div>
  );
}

const workspacePanelModeOptions: Array<[string, string]> = [
  ["open", "Plný"],
  ["collapsed", "Ikona"],
  ["hidden", "Skrýt"]
];

function ProfileEditor({
  profile,
  session,
  onChange,
  onHelp
}: {
  profile: OperatorProfilePreferences;
  session: AuthSession;
  onChange: (value: OperatorProfilePreferences) => void;
  onHelp: () => void;
}) {
  const fileInputId = React.useId();
  const [avatarError, setAvatarError] = React.useState<string | null>(null);

  const update = React.useCallback((patch: Partial<OperatorProfilePreferences>) => {
    onChange({ ...profile, ...patch });
  }, [onChange, profile]);

  const handleAvatarChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    setAvatarError(null);
    void readAvatarFile(file)
      .then((avatarDataUrl) => update({ avatarDataUrl }))
      .catch((error: unknown) => setAvatarError(error instanceof Error ? error.message : "Avatar se nepodařilo načíst."));
  }, [update]);

  return (
    <div className="profile-editor">
      <div className="settings-title-row">
        <PanelTitle icon={<UserCircle size={17} />} title="Profil uživatele" />
        <HelpHint label="Profil a kontakty" onOpen={onHelp} />
      </div>
      <div className="profile-editor-header">
        <OperatorAvatar profile={profile} />
        <div>
          <strong>{profile.displayName || session.profile?.name || "Uživatel CSM"}</strong>
          <span>{profile.role || "Kontakt pro krizovou komunikaci"}</span>
        </div>
      </div>
      <input id={fileInputId} className="visually-hidden" accept="image/png,image/jpeg,image/webp" type="file" onChange={handleAvatarChange} />
      <div className="settings-button-row">
        <label className="mini-button file-like-button" htmlFor={fileInputId}>
          <Image size={14} />
          Vybrat avatar
        </label>
        {profile.avatarDataUrl ? (
          <button className="mini-button" onClick={() => update({ avatarDataUrl: undefined })} type="button">
            Odebrat
          </button>
        ) : null}
      </div>
      {avatarError ? <div className="error-banner">{avatarError}</div> : null}
      <label className="text-field">
        Zobrazované jméno
        <input value={profile.displayName ?? ""} onChange={(event) => update({ displayName: event.target.value })} placeholder={session.profile?.name ?? "Jméno a příjmení"} />
      </label>
      <label className="text-field">
        Role
        <input value={profile.role ?? ""} onChange={(event) => update({ role: event.target.value })} placeholder="Dobrovolník, koordinátor, starosta..." />
      </label>
      <label className="text-field">
        Organizace
        <input value={profile.organization ?? ""} onChange={(event) => update({ organization: event.target.value })} placeholder="Obec, jednotka, firma, tým" />
      </label>
      <label className="text-field">
        E-mail
        <input value={profile.email ?? ""} onChange={(event) => update({ email: event.target.value })} placeholder={session.profile?.email ?? "kontakt@example.cz"} />
      </label>
      <label className="text-field">
        Telefon
        <input value={profile.phone ?? ""} onChange={(event) => update({ phone: event.target.value })} placeholder="+420 ..." />
      </label>
      <label className="text-field">
        Poznámka ke kontaktu
        <textarea value={profile.contactNote ?? ""} onChange={(event) => update({ contactNote: event.target.value })} placeholder="Kdy a jak mě kontaktovat" rows={3} />
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={Boolean(profile.publicContact)} onChange={(event) => update({ publicContact: event.target.checked })} />
        Kontakt může být viditelný členům skupin a incidentů
      </label>
    </div>
  );
}

function HelpHint({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button className="help-hint" onClick={onOpen} title={label} type="button">
      <HelpCircle size={14} />
    </button>
  );
}

function ManualDialog({
  section,
  onClose,
  onSectionChange
}: {
  section: HelpSection;
  onClose: () => void;
  onSectionChange: (section: HelpSection) => void;
}) {
  const entry = manualSections[section];
  return (
    <div className="ui-dialog-backdrop" role="presentation">
      <section className="ui-dialog manual-dialog" aria-modal="true" role="dialog" aria-labelledby="manual-title">
        <div className="ui-dialog-header">
          <div>
            <span>Manuál</span>
            <strong id="manual-title">{entry.title}</strong>
          </div>
          <button className="icon-button" onClick={onClose} title="Zavřít manuál" type="button">
            <X size={16} />
          </button>
        </div>
        <div className="manual-layout">
          <nav aria-label="Sekce manuálu">
            {Object.entries(manualSections).map(([key, item]) => (
              <button
                className={key === section ? "active" : ""}
                key={key}
                onClick={() => onSectionChange(key as HelpSection)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>
          <article>
            <p>{entry.body}</p>
            <ul>
              {entry.points.map((point) => <li key={point}>{point}</li>)}
            </ul>
          </article>
        </div>
      </section>
    </div>
  );
}

const manualSections: Record<HelpSection, { body: string; label: string; points: string[]; title: string }> = {
  alerts: {
    body: "Výstrahy jsou informační pomůcka pro rozhodování občanů a koordinátorů. Technické chyby zdrojů se oddělují od bezpečnostních událostí.",
    label: "Výstrahy",
    points: [
      "Sledujte platnost, zdroj a stáří výstrahy.",
      "Uživatelské zóny pomáhají hlídat konkrétní oblast, například domov, obec nebo trasu.",
      "Upozornění neposkytuje pokyn k zásahu; vždy respektujte místní krizové řízení."
    ],
    title: "Výstrahy a sledované oblasti"
  },
  layers: {
    body: "Katalog vrstev je hlavní způsob, jak zapnout lety, dopravu, počasí, bezpečnostní vrstvy, uživatelské zóny nebo technické kontexty.",
    label: "Vrstvy",
    points: [
      "Běžný civilní pohled zapínejte přes veřejné vrstvy, diagnostické zdroje používejte jen při kontrole dat.",
      "Některé vrstvy mají vlastní čas obnovy; COP využívá cache SIM a nedotazuje původní zdroje přímo.",
      "Při oddálení mohou být objekty shlukované, aby mapa zůstala čitelná."
    ],
    title: "Mapové vrstvy"
  },
  layout: {
    body: "Pracovní plocha je konfigurovatelná. Mapa má být hlavní, proto lze postranní panely sbalit nebo skrýt podle úkolu a velikosti obrazovky.",
    label: "Plocha",
    points: [
      "Skin mění vizuální charakter aplikace bez změny oprávnění nebo dat.",
      "Šablony Civilní, Operační a Terénní jedním krokem nastaví skin, rozložení, podklad mapy a symboliku.",
      "Táhnutím za okraj panelu upravíte jeho šířku na desktopu.",
      "Volba Ikona ponechá panel dostupný, ale uvolní místo mapě.",
      "U přihlášeného uživatele se rozložení ukládá do serverového profilu."
    ],
    title: "Pracovní plocha"
  },
  overview: {
    body: "Civilní situační mapa spojuje veřejné datové vrstvy, komunitní hlášení, zprávy a osobní výstrahy do jedné pracovní plochy.",
    label: "Přehled",
    points: [
      "Mapa je primární pohled pro rychlé pochopení situace v okolí.",
      "Chat řeší komunikaci a skupiny, zatímco hlášení zůstává mapovým bodem s polohou, platností a přílohami.",
      "Veřejné čtení funguje bez účtu, ukládání profilu, hlášení a komunikace vyžadují přihlášení."
    ],
    title: "Přehled aplikace"
  },
  profile: {
    body: "Profil pomáhá ostatním poznat, kdo posílá hlášení nebo komunikuje v chatu. Kontaktní údaje se používají jen tam, kde to dává smysl pro krizovou spolupráci.",
    label: "Profil",
    points: [
      "Avatar se zmenší a uloží do uživatelského profilu jako lehký obrázek.",
      "Veřejnost kontaktu zapínejte jen tehdy, pokud má být kontakt sdílen v rámci spolupráce nebo incidentů.",
      "Přihlašovací údaje spravuje přihlašovací služba; aplikace neukládá hesla."
    ],
    title: "Profil a kontakt"
  },
  reports: {
    body: "Hlášení slouží k vložení informací z terénu: text, poloha, nebezpečnost, platnost a přílohy. Poloha je klíčová pro správné varování.",
    label: "Hlášení",
    points: [
      "Pokud soubor nemá polohu, lze ji vybrat z mapy.",
      "Přílohy mají přístupová práva podle zvolené viditelnosti.",
      "Velké soubory zobrazují průběh nahrávání, aby nedošlo k nechtěnému obnovení stránky."
    ],
    title: "Komunitní hlášení"
  }
};

function readAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Avatar musí být obrázek PNG, JPG nebo WebP."));
  }
  if (file.size > 5_000_000) {
    return Promise.reject(new Error("Avatar je příliš velký. Použijte obrázek do 5 MB."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Avatar se nepodařilo přečíst."));
    reader.onload = () => {
      const image = new window.Image();
      image.onerror = () => reject(new Error("Avatar se nepodařilo zpracovat."));
      image.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Prohlížeč nepodporuje zpracování avataru."));
          return;
        }
        const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
        const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
        const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
        context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
        resolve(canvas.toDataURL("image/webp", 0.82));
      };
      image.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function MobileSheetPullHandle({ label, onClose }: { label: string; onClose: () => void }) {
  const [dragOffset, setDragOffset] = React.useState(0);
  const startYRef = React.useRef<number | null>(null);

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startYRef.current = event.clientY;
    setDragOffset(0);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (startYRef.current === null) {
        return;
      }
      const nextOffset = Math.max(0, moveEvent.clientY - startYRef.current);
      setDragOffset(Math.min(96, nextOffset));
    };

    const finishDrag = (upEvent: PointerEvent) => {
      const startY = startYRef.current;
      const deltaY = startY === null ? 0 : upEvent.clientY - startY;
      startYRef.current = null;
      setDragOffset(0);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      if (deltaY > 72) {
        onClose();
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
  }, [onClose]);

  return (
    <button
      aria-label={label}
      className="mobile-sheet-pull-handle"
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClose();
        }
      }}
      onPointerDown={handlePointerDown}
      style={{ transform: `translateY(${dragOffset}px)` }}
      type="button"
    >
      <span aria-hidden="true" />
      <small>{label}</small>
    </button>
  );
}

function CatalogLayerMenu({
  activeGroup,
  compactDrawerHeader = false,
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
  onUserZoneEdit,
  onUserZoneRadiusChange,
  onUserZoneStartDrawing,
  userZones,
  editingZoneId,
  zoneCreationMode
}: {
  activeGroup: CatalogGroupView | null;
  compactDrawerHeader?: boolean;
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
  onUserZoneEdit: (zoneId: string) => void;
  onUserZoneRadiusChange: (zoneId: string, radiusKm: number) => void;
  onUserZoneStartDrawing: () => void;
  userZones: AoiRule[];
  editingZoneId: string | null;
  zoneCreationMode: boolean;
}) {
  const activeLayerCount = groups.reduce((sum, view) => sum + view.layers.filter(isLayerEnabled).length, 0);
  const lastTouchGroupSelectRef = React.useRef<{ groupId: string; at: number } | null>(null);
  const handleGroupPointerUp = React.useCallback((event: React.PointerEvent<HTMLButtonElement>, groupId: string) => {
    if (event.pointerType === "mouse") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    lastTouchGroupSelectRef.current = { groupId, at: Date.now() };
    onGroupSelect(groupId);
  }, [onGroupSelect]);
  const handleGroupClick = React.useCallback((event: React.MouseEvent<HTMLButtonElement>, groupId: string) => {
    event.stopPropagation();
    const lastTouchSelect = lastTouchGroupSelectRef.current;
    if (lastTouchSelect?.groupId === groupId && Date.now() - lastTouchSelect.at < 700) {
      return;
    }
    onGroupSelect(groupId);
  }, [onGroupSelect]);
  return (
    <div
      className="catalog-layer-menu"
      data-testid="catalog-layer-rail"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
    >
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
              onClick={(event) => handleGroupClick(event, view.group.groupId)}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => handleGroupPointerUp(event, view.group.groupId)}
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
          compactHeader={compactDrawerHeader}
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
          onUserZoneEdit={onUserZoneEdit}
          onUserZoneRadiusChange={onUserZoneRadiusChange}
          onUserZoneStartDrawing={onUserZoneStartDrawing}
          userZones={userZones}
          editingZoneId={editingZoneId}
          zoneCreationMode={zoneCreationMode}
        />
      ) : null}
    </div>
  );
}

function CatalogLayerDrawer({
  compactHeader = false,
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
  onUserZoneEdit,
  onUserZoneRadiusChange,
  onUserZoneStartDrawing,
  userZones,
  editingZoneId,
  zoneCreationMode
}: {
  compactHeader?: boolean;
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
  onUserZoneEdit: (zoneId: string) => void;
  onUserZoneRadiusChange: (zoneId: string, radiusKm: number) => void;
  onUserZoneStartDrawing: () => void;
  userZones: AoiRule[];
  editingZoneId: string | null;
  zoneCreationMode: boolean;
}) {
  const enabledCount = groupView.layers.filter(isLayerEnabled).length;
  return (
    <section
      className="catalog-layer-drawer"
      data-testid="catalog-layer-drawer"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
    >
      {!compactHeader ? (
        <div className="catalog-drawer-header">
          <div>
            <span>Katalog vrstev</span>
            <strong>{groupView.group.label}</strong>
          </div>
          <button aria-label="Zavřít katalog vrstev" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
      ) : null}
      <div className="catalog-drawer-summary">
        <ReadinessRow label="Zapnuto" value={`${enabledCount}/${groupView.layers.length}`} tone={enabledCount > 0 ? "ok" : "neutral"} />
      </div>
      {loadError ? <div className="catalog-warning">API chyba: {loadError}</div> : null}
      <div className="catalog-layer-list">
        {groupView.layers.map((layer) => {
          const enabled = isLayerEnabled(layer);
          const operable = isLayerOperable(layer);
          const status = getLayerStatus(layer);
          const toggleLayer = () => {
            if (operable) {
              onToggleLayer(layer);
            }
          };
          return (
            <div
              aria-checked={enabled}
              aria-disabled={!operable}
              className={`catalog-layer-row ${enabled ? "enabled" : ""} ${!operable ? "disabled" : ""}`}
              key={layer.layerId}
              onClick={(event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest("button,input,select,textarea,a")) {
                  return;
                }
                toggleLayer();
              }}
              onKeyDown={(event) => {
                if (!operable || (event.key !== "Enter" && event.key !== " ")) {
                  return;
                }
                event.preventDefault();
                toggleLayer();
              }}
              role="switch"
              tabIndex={operable ? 0 : -1}
            >
              <div className="catalog-layer-toggle" title={layer.description ?? layer.label}>
                <input
                  aria-label={`Zobrazit vrstvu ${layer.label}`}
                  checked={enabled}
                  disabled={!operable}
                  onChange={(event) => {
                    event.stopPropagation();
                    toggleLayer();
                  }}
                  onClick={(event) => event.stopPropagation()}
                  type="checkbox"
                />
                <span>
                  <strong>{layer.label}</strong>
                  <small>{catalogLayerHint(layer, operable)}</small>
                </span>
                <em>{getFeatureCount(layer)}</em>
              </div>
              <div className="catalog-layer-meta">
                <span className={`catalog-status ${enabled ? status : "disabled"}`}>{enabled ? catalogLayerStatusLabel(status) : "vypnuto"}</span>
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
                  editingZoneId={editingZoneId}
                  zones={userZones}
                  onColorChange={onUserZoneColorChange}
                  onCreateFromMap={onUserZoneCreateFromMap}
                  onCreateFromUserLocation={onUserZoneCreateFromUserLocation}
                  onDelete={onUserZoneDelete}
                  onEnabledChange={onUserZoneEnabledChange}
                  onEdit={onUserZoneEdit}
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
    { count: scopedObjects.length, description: "Všechny přijaté georeferencované objekty po aktivních filtrech.", label: "Celkový obraz", layerId: "air-situation" },
    { count: getSimulatedAirCount(scopedObjects), description: "Cvičná letecká situace ze simulačního zdroje.", label: "Simulace", layerId: "sim-air" },
    { count: getUavCount(scopedObjects), description: "Bezpilotní prostředky a UAV.", label: "UAV", layerId: "uav" },
    { count: metrics.friendlyCount, description: "Vlastní a pravděpodobně vlastní objekty.", label: "Vlastní", layerId: "friendly" },
    { count: metrics.foreignCount, description: "Rizikové nebo neověřené objekty.", label: "Rizikové", layerId: "foreign" },
    { count: metrics.publicFlightCount, description: "Veřejná letová data z leteckého zdroje.", label: "Veřejné lety", layerId: "public-flights" },
    { count: getDataQualityCount(scopedObjects), description: "Objekty s nízkou jistotou nebo datovou nejistotou.", label: "Kvalita dat", layerId: "data-quality" }
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
  editingZoneId,
  zones,
  onColorChange,
  onCreateFromMap,
  onCreateFromUserLocation,
  onDelete,
  onEnabledChange,
  onEdit,
  onRadiusChange,
  onStartMapClickCreation
}: {
  creationMode: boolean;
  editingZoneId: string | null;
  zones: AoiRule[];
  onColorChange: (zoneId: string, color: string) => void;
  onCreateFromMap: () => void;
  onCreateFromUserLocation: () => void;
  onDelete: (zoneId: string) => void;
  onEnabledChange: (zoneId: string, enabled: boolean) => void;
  onEdit: (zoneId: string) => void;
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
        {zones.map((zone) => {
          const isEditing = editingZoneId === zone.id;
          return (
          <div className={`user-zone-row ${isEditing ? "editing" : ""}`} key={zone.id}>
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
            {zone.polygon ? (
              <button className={`mini-button wide ${isEditing ? "active" : ""}`} onClick={() => onEdit(zone.id)} type="button">
                <MousePointer2 size={14} />
                {isEditing ? "Ukončit editaci" : "Upravit v mapě"}
              </button>
            ) : null}
            <button className="mini-button danger wide" onClick={() => onDelete(zone.id)} type="button">
              <Trash2 size={14} />
              Smazat
            </button>
          </div>
          );
        })}
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
  const objectTitle = formatObjectListLabel(object);

  return (
    <div className="object-detail">
      <div className="object-header">
        <div>
          <strong>{objectTypeDisplayName(object.objectType)}</strong>
          <span>{objectTitle}</span>
        </div>
        <em>{objectStatusLabel(object.status)}</em>
      </div>

      <ObjectDetailSection title="Identita">
        <DetailGrid
          rows={[
            ["Příslušnost", <span className={`affiliation-chip ${model.affiliation.disposition}`}>{model.affiliation.label}</span>],
            ["Doména", domainDisplayName(object.domain)],
            ["Stav", replayActive ? `${objectStatusLabel(object.status)} / zpětné přehrání` : objectStatusLabel(object.status)],
            ["Jistota", `${Math.round((object.confidence ?? 0) * 100)} %`]
          ]}
        />
      </ObjectDetailSection>

      <ObjectDetailSection title="Poloha">
        <DetailGrid
          rows={[
            ["Souřadnice", formatPosition(object)],
            ["Pohyb", formatMovement(object)],
            ["Stáří dat", formatAge(object.lastUpdatedAt)],
            ["Body historie", String(historyPoints.length)]
          ]}
        />
      </ObjectDetailSection>

      <ObjectDetailSection title="Zobrazení">
        <DetailGrid
          rows={[
            ["Režim", "Standardní operační symbol"],
            ["Vyhodnocení", `${objectTypeDisplayName(object.objectType)} / ${model.affiliation.label} / ${objectStatusLabel(object.status)}`]
          ]}
        />
      </ObjectDetailSection>

      <ObjectDetailSection title="Zdroj">
        <DetailGrid
          rows={[
            ["Zdroj", sourceDisplayName(model.provenance?.sourceSystemId)],
            ["Aktualizace", formatShortDateTime(model.provenance?.producerTimestamp ?? object.lastUpdatedAt)],
            ["Odezva", formatLatency(model.provenance?.latencyMs)],
            ["Spolehlivost", formatReliability(model.provenance)]
          ]}
        />
      </ObjectDetailSection>

      {flightData ? (
        <ObjectDetailSection title="Letová data">
          <DetailGrid
            rows={[
              ["Volací znak", displayValue(flightData.callsign)],
              ["Registrace", displayValue(flightData.registration)],
              ["Typ letadla", formatFlightAircraft(flightData)],
              ["Země původu", displayValue(flightData.originCountry)]
            ]}
          />
        </ObjectDetailSection>
      ) : null}

      <ObjectDetailSection title="Jistota">
        <ConfidenceFactorList factors={model.confidenceFactors} />
      </ObjectDetailSection>

      <ObjectDetailSection title="Konflikty">
        <ConflictList conflicts={model.conflicts} />
      </ObjectDetailSection>

      <div className="object-flags">
        {object.synthetic ? <span className="synthetic-badge">SIM</span> : null}
        {isPublicFlightObject(object) ? <span className="public-flight-badge">VEŘEJNÝ LET</span> : null}
        {isMockFlightObject(object) ? <span className="warning-badge">CVIČNÁ DATA</span> : null}
        {object.status === "STALE" || flightData?.quality?.stale ? <span className="warning-badge">STARŠÍ DATA</span> : null}
        {(object.confidence ?? 0) < 0.5 ? <span className="warning-badge">NÍZKÁ JISTOTA</span> : null}
        {model.conflicts.some((conflict) => conflict.severity === "warn") ? <span className="warning-badge">KONFLIKT DAT</span> : null}
      </div>
    </div>
  );
}

type MobileTechnicalCoverageState =
  | { status: "idle" }
  | { status: "loading" }
  | { feature: SituationFeature | null; status: "loaded"; warnings: string[] }
  | { error: string; status: "error" };

type MobileTowerViewshedState =
  | { status: "idle" }
  | { status: "loading"; technology: CoverageTechnology; towerId: string }
  | { error: string; status: "error"; technology: CoverageTechnology; towerId: string }
  | {
      features: SituationFeature[];
      response: MobileTowerViewshedResponse;
      status: "loaded";
      technology: CoverageTechnology;
      towerId: string;
    };

function appendRadioLosFeatures(
  collection: SituationFeatureCollectionResponse | null,
  overlay: RadioLosMapOverlay | null
): SituationFeatureCollectionResponse | null {
  if (!collection || !overlay || overlay.features.length === 0) {
    return collection;
  }
  return {
    ...collection,
    features: [...collection.features, ...overlay.features],
    summary: {
      ...collection.summary,
      featureCount: collection.summary.featureCount + overlay.features.length,
      warningCount: collection.summary.warningCount + overlay.warnings.length
    },
    warnings: [...collection.warnings, ...overlay.warnings]
  };
}

function buildRadioInputOverlay(
  mode: RadioLosMode,
  station: RadioPoint,
  linkFrom: RadioPoint,
  linkTo: RadioPoint,
  searchTargets: RadioPoint[],
  profile: RadioProfile
): RadioLosMapOverlay {
  const features: SituationFeature[] = [];
  if (mode === "coverage") {
    features.push(radioInputPointToSituationFeature("station", station, profile));
  } else if (mode === "link") {
    features.push(
      radioInputPointToSituationFeature("from", linkFrom, profile),
      radioInputPointToSituationFeature("to", linkTo, profile),
      radioInputLineToSituationFeature(linkFrom, linkTo, profile)
    );
  } else {
    const target = searchTargets[0] ?? defaultRadioPoint;
    features.push(radioInputPointToSituationFeature("site-target", target, profile));
  }
  return { features, mode, title: "Vstupní body Radio LoS", warnings: [] };
}

function radioInputPointToSituationFeature(target: RadioPointPickTarget, point: RadioPoint, profile: RadioProfile): SituationFeature {
  const label = radioPointTargetLabel(target);
  const featureId = `radio:input:${target}`;
  const coordinateLabel = `${formatRadioCoordinate(point.lat)}, ${formatRadioCoordinate(point.lon)}`;
  return {
    geometry: {
      coordinates: [point.lon, point.lat],
      type: "Point"
    },
    id: featureId,
    properties: {
      category: "radio_input",
      confidence: 1,
      dataQuality: "operator_input",
      description: `${label}: ${coordinateLabel}`,
      featureId,
      label: `Radio: ${label}`,
      layer: "mobile",
      layerId: "analysis.radio.input",
      metrics: {
        antennaHeightM: point.antennaHeightM,
        receiverHeightM: point.receiverHeightM
      },
      providerId: "cop-web",
      providerLayerId: "radio.input",
      providerProperties: {
        point,
        profileId: profile.profileId ?? "custom",
        role: target
      },
      quality: "unknown",
      sourceId: "radio_los_input",
      sourceName: "COP Radio LoS",
      status: "input",
      summary: `${label} pro výpočet Radio LoS. ${coordinateLabel}`,
      tags: {
        profileId: profile.profileId ?? "custom",
        radioInput: "true",
        radioInputRole: target,
        radioInputRoleLabel: `Radio: ${label}`,
        radioOverlay: "true"
      },
      typeCode: "radio.input"
    },
    type: "Feature"
  };
}

function radioInputLineToSituationFeature(from: RadioPoint, to: RadioPoint, profile: RadioProfile): SituationFeature {
  return {
    geometry: {
      coordinates: [[from.lon, from.lat], [to.lon, to.lat]],
      type: "LineString"
    },
    id: "radio:input:link",
    properties: {
      category: "radio_input_link",
      confidence: 1,
      dataQuality: "operator_input",
      featureId: "radio:input:link",
      label: "Radio: plánovaná trasa spojení",
      layer: "mobile_coverage",
      layerId: "analysis.radio.input",
      providerId: "cop-web",
      providerLayerId: "radio.input_link",
      providerProperties: {
        from,
        profileId: profile.profileId ?? "custom",
        to
      },
      quality: "unknown",
      sourceId: "radio_los_input",
      sourceName: "COP Radio LoS",
      status: "input",
      summary: "Vstupní linie pro bod-bod Radio LoS výpočet.",
      tags: {
        profileId: profile.profileId ?? "custom",
        radioInput: "true",
        radioInputRole: "link",
        radioInputRoleLabel: "Radio: plánovaná trasa spojení",
        radioOverlay: "true"
      },
      typeCode: "radio.input_link"
    },
    type: "Feature"
  };
}

function radioPointForTarget(
  target: RadioPointPickTarget,
  station: RadioPoint,
  linkFrom: RadioPoint,
  linkTo: RadioPoint,
  searchTargets: RadioPoint[]
): RadioPoint {
  if (target === "station") {
    return station;
  }
  if (target === "from") {
    return linkFrom;
  }
  if (target === "to") {
    return linkTo;
  }
  return searchTargets[0] ?? defaultRadioPoint;
}

function radioPointFromMapClick(point: RadioPoint, center: { lat: number; lon: number }): RadioPoint {
  return {
    ...point,
    lat: roundRadioCoordinate(center.lat),
    lon: roundRadioCoordinate(center.lon)
  };
}

function roundRadioCoordinate(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function formatRadioCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(5) : "n/a";
}

function radioPointPickTargetLabel(target: RadioPointPickTarget): string {
  switch (target) {
    case "station":
      return "stanici pro výpočet pokrytí";
    case "from":
      return "výchozí bod spojení";
    case "to":
      return "cílový bod spojení";
    case "site-target":
      return "cílový bod hledání stanoviště";
  }
}

function radioPointTargetLabel(target: RadioPointPickTarget): string {
  switch (target) {
    case "station":
      return "stanice";
    case "from":
      return "odkud";
    case "to":
      return "kam";
    case "site-target":
      return "cíl spojení";
  }
}

function radioFeatureCollectionToSituationFeatures(
  response: RadioFeatureCollectionResponse,
  mode: RadioLosMode,
  profile: RadioProfile
): SituationFeature[] {
  return response.features.map((feature, index) => {
    const sourceProperties = feature.properties;
    const score = numberProperty(sourceProperties.score);
    const quality = stringProperty(sourceProperties.quality) ?? radioQualityFromScore(score);
    const confidence = boundedUnit(numberProperty(sourceProperties.confidence) ?? score ?? 0.45);
    const candidateLabel = mode === "site" ? `Kandidát ${index + 1}` : radioLosModeLabel(mode);
    const label = stringProperty(sourceProperties.label)
      ?? stringProperty(sourceProperties.name)
      ?? stringProperty(sourceProperties.summary)
      ?? candidateLabel;
    const layer: SituationLayerId = mode === "site" && feature.geometry.type === "Point" ? "mobile" : "mobile_coverage";
    return {
      geometry: feature.geometry,
      id: feature.id ?? `radio:${mode}:${profile.profileId ?? "custom"}:${index}`,
      properties: {
        category: mode === "site" ? "radio_site_candidate" : "radio_los",
        confidence,
        dataQuality: "model",
        disclaimer: radioLosDisclaimer,
        estimatedSignalDbm: numberProperty(sourceProperties.estimatedSignalDbm),
        featureId: `radio:${mode}:${profile.profileId ?? "custom"}:${index}`,
        generatedAt: response.generatedAt,
        label,
        layer,
        layerId: `analysis.radio.${mode}`,
        metrics: {
          ...(isRecord(sourceProperties.metrics) ? sourceProperties.metrics : {}),
          ...(score !== undefined ? { score } : {}),
          ...(numberProperty(sourceProperties.coveredAreaPct) !== undefined ? { coveredAreaPct: numberProperty(sourceProperties.coveredAreaPct) } : {}),
          ...(numberProperty(sourceProperties.minClearanceM) !== undefined ? { minClearanceM: numberProperty(sourceProperties.minClearanceM) } : {}),
          ...(numberProperty(sourceProperties.visibleTargetCount) !== undefined ? { visibleTargetCount: numberProperty(sourceProperties.visibleTargetCount) } : {})
        },
        modelVersion: stringProperty(sourceProperties.modelVersion) ?? stringProperty(response.metadata?.model),
        providerId: response.providerId ?? "sim.situation-data",
        providerLayerId: `radio.${mode}`,
        providerProperties: sourceProperties,
        quality,
        sourceId: "radio_los_model",
        sourceName: "SIM Radio LoS",
        status: radioStatusFromQuality(quality),
        summary: stringProperty(sourceProperties.summary) ?? radioLosDisclaimer,
        tags: {
          profileId: profile.profileId ?? "custom",
          radioOverlay: "true",
          radioOverlayMode: mode
        },
        typeCode: `radio.${mode}`,
        validUntil: response.generatedAt
      },
      type: "Feature"
    } satisfies SituationFeature;
  });
}

function radioLinkCheckToSituationFeature(
  response: RadioLinkCheckResponse,
  request: RadioLinkCheckRequest,
  profile: RadioProfile
): SituationFeature {
  const quality = radioQualityFromLinkStatus(response.linkStatus);
  return {
    geometry: {
      coordinates: [[request.from.lon, request.from.lat], [request.to.lon, request.to.lat]],
      type: "LineString"
    },
    id: `radio:link:${profile.profileId ?? "custom"}:${request.from.lon}:${request.from.lat}:${request.to.lon}:${request.to.lat}`,
    properties: {
      category: "radio_link_check",
      confidence: boundedUnit((response.fresnelClearancePct ?? 0) / 100),
      dataQuality: "model",
      disclaimer: radioLosDisclaimer,
      featureId: `radio:link:${profile.profileId ?? "custom"}:${Date.now()}`,
      generatedAt: response.generatedAt,
      label: `Spojení ${radioLinkStatusLabel(response.linkStatus)}`,
      layer: "mobile_coverage",
      layerId: "analysis.radio.link",
      metrics: {
        azimuthDeg: response.azimuthDeg,
        distanceM: response.distanceM,
        fresnelClearancePct: response.fresnelClearancePct,
        maxObstructionM: response.maxObstructionM,
        requiredExtraAntennaHeightM: response.requiredExtraAntennaHeightM
      },
      providerId: "sim.situation-data",
      providerLayerId: "radio.link_check",
      providerProperties: {
        request,
        response
      },
      quality,
      sourceId: "radio_los_model",
      sourceName: "SIM Radio LoS",
      status: radioStatusFromQuality(quality),
      summary: radioLosDisclaimer,
      tags: {
        profileId: profile.profileId ?? "custom",
        radioOverlay: "true",
        radioOverlayMode: "link"
      },
      typeCode: "radio.link_check"
    },
    type: "Feature"
  };
}

function radioLosModeLabel(mode: RadioLosMode): string {
  switch (mode) {
    case "coverage":
      return "Pokrytí z bodu";
    case "link":
      return "Spojení bod-bod";
    case "site":
      return "Najít stanoviště";
  }
}

function radioQualityFromScore(score: number | undefined): string {
  if (score === undefined) {
    return "unknown";
  }
  if (score >= 0.78) {
    return "good";
  }
  if (score >= 0.52) {
    return "fair";
  }
  if (score >= 0.24) {
    return "weak";
  }
  return "none";
}

function radioQualityFromLinkStatus(status: string | undefined): string {
  if (status === "clear") {
    return "good";
  }
  if (status === "marginal") {
    return "fair";
  }
  if (status === "obstructed") {
    return "none";
  }
  return "unknown";
}

function radioStatusFromQuality(quality: string): string {
  if (quality === "good") {
    return "ok";
  }
  if (quality === "fair" || quality === "weak") {
    return "weak_signal";
  }
  if (quality === "none") {
    return "degraded_possible";
  }
  return "unknown";
}

function radioLinkStatusLabel(status: string | undefined): string {
  switch (status) {
    case "clear":
      return "průchodné";
    case "marginal":
      return "mezní";
    case "obstructed":
      return "zastíněné";
    default:
      return "neznámé";
  }
}

function formatMeters(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  return Math.abs(value) >= 1000 ? `${Math.round((value / 1000) * 10) / 10} km` : `${Math.round(value)} m`;
}

function useMobileTowerViewshed(
  apiBase: string,
  authToken: string | undefined,
  feature: SituationFeature | null,
  technology: CoverageTechnology
): MobileTowerViewshedState {
  const [state, setState] = React.useState<MobileTowerViewshedState>({ status: "idle" });

  React.useEffect(() => {
    if (!feature || !isCommunicationTowerFeature(feature)) {
      setState({ status: "idle" });
      return undefined;
    }
    const towerId = mobileTowerViewshedId(feature);
    if (!towerId) {
      setState({
        error: "Vybraná věž nemá v datech OSM/SIM použitelný towerId.",
        status: "error",
        technology,
        towerId: "n/a"
      });
      return undefined;
    }

    let cancelled = false;
    setState({ status: "loading", technology, towerId });
    fetchMobileTowerViewshed(apiBase, authToken, towerId, {
      azimuthStepDeg: 10,
      distanceStepM: 500,
      radiusM: 12_000,
      technology
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setState({
          features: mobileTowerViewshedResponseToSituationFeatures(response, feature, towerId, technology),
          response,
          status: "loaded",
          technology,
          towerId
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          error: error instanceof Error ? humanizeApiError(error.message) : "Modelovaný dosah BTS se nepodařilo načíst.",
          status: "error",
          technology,
          towerId
        });
      });

    return () => {
      cancelled = true;
    };
  }, [apiBase, authToken, feature, technology]);

  return state;
}

function appendMobileTowerViewshedFeatures(
  collection: SituationFeatureCollectionResponse | null,
  state: MobileTowerViewshedState
): SituationFeatureCollectionResponse | null {
  if (state.status !== "loaded" || state.features.length === 0 || !collection) {
    return collection;
  }
  return {
    ...collection,
    features: [...collection.features, ...state.features],
    summary: {
      ...collection.summary,
      featureCount: collection.summary.featureCount + state.features.length,
      warningCount: collection.summary.warningCount + state.response.warnings.length
    },
    warnings: [...collection.warnings, ...state.response.warnings]
  };
}

function mobileTowerViewshedId(feature: SituationFeature): string | undefined {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
  const providerTags = isRecord(providerProperties.tags) ? providerProperties.tags : {};
  const osmType = stringProperty(tags.osmType) ?? stringProperty(providerTags.osmType);
  const osmId = stringProperty(tags.osmId) ?? stringProperty(providerTags.osmId);
  if (osmType && osmId) {
    return `${osmType}:${osmId}`;
  }
  return stringProperty(tags.nearestTowerId)
    ?? stringProperty(providerTags.nearestTowerId)
    ?? stringProperty(feature.properties.featureId?.startsWith("mobile:osm_postgis:") ? feature.properties.featureId.replace(/^mobile:osm_postgis:/u, "") : undefined);
}

function mobileTowerViewshedResponseToSituationFeatures(
  response: MobileTowerViewshedResponse,
  towerFeature: SituationFeature,
  towerId: string,
  technology: CoverageTechnology
): SituationFeature[] {
  const tower = isRecord(response.tower) ? response.tower : {};
  const summary = isRecord(response.summary) ? response.summary : {};
  const disclaimer = stringProperty(summary.disclaimer)
    ?? "Mobilní pokrytí je modelovaný odhad SIM. Stav konkrétní BTS není potvrzen autorizovaným operátorským/NOC feedem.";
  return response.features.flatMap((viewshedFeature, index) => {
    const sourceProperties = viewshedFeature.properties;
    const sourceMetrics = isRecord(sourceProperties.metrics) ? sourceProperties.metrics : {};
    const sourceAssumptions = isRecord(sourceProperties.assumptions) ? sourceProperties.assumptions : {};
    const confidence = boundedUnit(numberProperty(sourceProperties.confidence) ?? recordNumber(sourceMetrics, "confidence") ?? 0.45);
    const quality = stringProperty(sourceProperties.quality) ?? "unknown";
    const metrics = {
      ...sourceMetrics,
      ...(numberProperty(sourceProperties.estimatedSignalDbm) !== undefined ? { estimatedSignalDbm: numberProperty(sourceProperties.estimatedSignalDbm) } : {}),
      ...(numberProperty(sourceProperties.terrainPenaltyDb) !== undefined ? { terrainPenaltyDb: numberProperty(sourceProperties.terrainPenaltyDb) } : {}),
      ...(numberProperty(sourceProperties.terrainMaxObstructionM) !== undefined ? { terrainMaxObstructionM: numberProperty(sourceProperties.terrainMaxObstructionM) } : {})
    };
    const assumptions = {
      ...sourceAssumptions,
      lineOfSightClear: booleanProperty(sourceProperties.lineOfSightClear) ?? booleanProperty(sourceMetrics.lineOfSightClear),
      operatorRfPlanAvailable: booleanProperty(sourceAssumptions.operatorRfPlanAvailable) ?? false,
      sectorAware: booleanProperty(sourceAssumptions.sectorAware) ?? false
    };
    return [{
      geometry: viewshedFeature.geometry,
      id: viewshedFeature.id ?? `mobile:tower_viewshed:${towerId}:${technology}:${index}`,
      properties: {
        assumptions,
        btsStatus: stringProperty(tower.btsStatus) ?? towerFeature.properties.btsStatus ?? "operator_feed_unavailable",
        category: "tower_viewshed",
        confidence,
        dataQuality: "model",
        demSource: stringProperty(sourceProperties.demSource) ?? towerFeature.properties.demSource,
        disclaimer,
        estimatedSignalDbm: numberProperty(sourceProperties.estimatedSignalDbm) ?? recordNumber(sourceMetrics, "estimatedSignalDbm"),
        featureId: `mobile:tower_viewshed:${towerId}:${technology}:${index}`,
        generatedAt: response.generatedAt,
        label: `Modelovaný dosah ${technology}`,
        layer: "mobile_coverage",
        layerId: "diagnostic.mobile.tower_viewshed",
        metrics,
        modelVersion: stringProperty(sourceProperties.modelVersion) ?? towerFeature.properties.modelVersion,
        observedAt: response.generatedAt,
        operator: towerFeature.properties.operator,
        operatorStatusAvailable: booleanProperty(tower.operatorStatusAvailable) ?? towerFeature.properties.operatorStatusAvailable ?? false,
        providerId: "sim.situation-data",
        providerLayerId: "mobile.tower_viewshed",
        quality,
        sourceId: "mobile_coverage_model",
        sourceName: "SIM model dosahu BTS",
        stale: false,
        status: stringProperty(sourceProperties.status) ?? mobileViewshedStatusFromQuality(quality),
        summary: stringProperty(sourceProperties.summary) ?? stringProperty(summary.label) ?? `Modelovaný sektor dosahu BTS ${towerId}`,
        tags: {
          parentFeatureId: towerFeature.properties.featureId,
          towerId,
          viewshedOverlay: "true"
        },
        technology,
        validUntil: towerFeature.properties.validUntil
      },
      type: "Feature"
    } satisfies SituationFeature];
  });
}

function mobileViewshedStatusFromQuality(quality: string): string {
  const normalized = quality.trim().toLowerCase();
  if (normalized === "good") {
    return "ok";
  }
  if (normalized === "fair" || normalized === "weak") {
    return "weak_signal";
  }
  if (normalized === "none") {
    return "degraded_possible";
  }
  return "unknown";
}

function isMobileTowerViewshedOverlayFeature(feature: SituationFeature): boolean {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return feature.properties.providerLayerId === "mobile.tower_viewshed"
    || stringProperty(tags.viewshedOverlay) === "true";
}

function boundedUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function useMobileNetworkTechnicalCoverage(
  apiBase: string,
  authToken: string | undefined,
  feature: SituationFeature
): MobileTechnicalCoverageState {
  const [state, setState] = React.useState<MobileTechnicalCoverageState>({ status: "idle" });

  React.useEffect(() => {
    if (feature.properties.layer === "mobile_coverage") {
      setState({ feature, status: "loaded", warnings: [] });
      return;
    }
    if (feature.properties.layer !== "mobile_network") {
      setState({ status: "idle" });
      return;
    }
    const bbox = mobileNetworkDetailBbox(feature);
    if (!bbox) {
      setState({ feature: null, status: "loaded", warnings: ["Technický model pokrytí nemá použitelnou geometrii."] });
      return;
    }

    let cancelled = false;
    const technology = normalizeMobileDetailTechnology(feature.properties.technology);
    setState({ status: "loading" });
    fetchMapFeatures(apiBase, authToken, {
      bbox,
      filters: technology ? { "diagnostic.mobile.coverage": { technology: [technology] } } : {},
      includeDiagnostics: true,
      layerIds: ["diagnostic.mobile.coverage"],
      limit: 80
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const candidates = response.situation?.features.filter((candidate) =>
          candidate.properties.layer === "mobile_coverage"
          && (!technology || normalizeMobileDetailTechnology(candidate.properties.technology) === technology)
        ) ?? [];
        setState({
          feature: candidates[0] ?? null,
          status: "loaded",
          warnings: [...response.warnings, ...(response.situation?.warnings ?? [])].slice(0, 3)
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          error: error instanceof Error ? error.message : "Technický model pokrytí není dostupný.",
          status: "error"
        });
      });

    return () => {
      cancelled = true;
    };
  }, [apiBase, authToken, feature]);

  return state;
}

function normalizeMobileDetailTechnology(value: string | undefined): CoverageTechnology | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized === "2G" || normalized === "4G" || normalized === "5G" ? normalized : undefined;
}

function mobileNetworkDetailBbox(feature: SituationFeature): MapBounds | null {
  const coordinates = situationGeometryCoordinates(feature.geometry);
  if (coordinates.length === 0) {
    return null;
  }
  const west = Math.min(...coordinates.map(([lon]) => lon));
  const east = Math.max(...coordinates.map(([lon]) => lon));
  const south = Math.min(...coordinates.map(([, lat]) => lat));
  const north = Math.max(...coordinates.map(([, lat]) => lat));
  const span = Math.max(east - west, north - south, 0.01);
  const padding = Math.min(0.08, Math.max(0.01, span * 0.2));
  return {
    east: clamp(east + padding, -180, 180),
    north: clamp(north + padding, -90, 90),
    south: clamp(south - padding, -90, 90),
    west: clamp(west - padding, -180, 180)
  };
}

function situationGeometryCoordinates(geometry: SituationFeature["geometry"]): Array<[number, number]> {
  const coordinates: Array<[number, number]> = [];
  collectSituationCoordinates(geometry.coordinates, coordinates);
  return coordinates;
}

function collectSituationCoordinates(value: unknown, coordinates: Array<[number, number]>): void {
  if (!Array.isArray(value)) {
    return;
  }
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    const lon = Number(value[0]);
    const lat = Number(value[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      coordinates.push([clamp(lon, -180, 180), clamp(lat, -90, 90)]);
    }
    return;
  }
  for (const item of value) {
    collectSituationCoordinates(item, coordinates);
  }
}

function SituationFeatureDetail({
  apiBase,
  authToken,
  feature,
  mobileTowerViewshed,
  onDeleteReport,
  onEditReport,
  onOpenChat,
  onOpenGallery
}: {
  apiBase: string;
  authToken: string | undefined;
  feature: SituationFeature;
  mobileTowerViewshed?: MobileTowerViewshedState;
  onDeleteReport?: (reportId: string) => void;
  onEditReport?: (feature: SituationFeature) => void;
  onOpenChat?: (feature: SituationFeature) => void;
  onOpenGallery?: (
    attachments: NonNullable<SituationFeature["properties"]["attachments"]>,
    index: number,
    title: string,
    subtitle?: string
  ) => void;
}) {
  const properties = feature.properties;
  const technicalCoverage = useMobileNetworkTechnicalCoverage(apiBase, authToken, feature);
  const status = situationFeatureStatusModel(feature);
  const isCommunityReport = properties.layer === "community" && typeof properties.reportId === "string";
  const trafficPresentation = properties.layer === "traffic" ? resolveTransportPresentation(feature) : null;
  const weatherCamera = isWeatherWebcamFeature(feature);
  const weatherContext = isWeatherContextFeature(feature) && !isAviationWeatherFeature(feature) && !weatherCamera;
  const floodDetail = properties.layer === "flood";
  const title = isMissionArenaFeature(feature)
    ? missionArenaDetailTitle(feature)
    : weatherCamera
      ? weatherWebcamTitle(feature)
    : weatherContext
      ? weatherFeatureHeadline(feature)
      : trafficPresentation
      ? [trafficPresentation.label, trafficPresentation.routeShortName].filter(Boolean).join(" ")
      : properties.headline ?? properties.label;
  const legacyCommunityGroup = isCommunityReport && typeof properties.groupName === "string" && properties.groupName.trim()
    ? properties.groupName.trim()
    : undefined;
  const linkedCommunityGroupId = isCommunityReport && typeof properties.groupId === "string" ? properties.groupId : undefined;
  const subtitle = weatherContext
    ? weatherFeatureSubtitle(feature)
    : weatherCamera
    ? weatherWebcamSubtitle(feature)
    : isCommunityReport
      ? [legacyCommunityGroup ? `skupina: ${legacyCommunityGroup}` : undefined, properties.reportId].filter(Boolean).join(" · ")
      : properties.featureId;
  return (
    <div className="object-detail situation-feature-detail">
      <div className="object-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="object-header-badges">
          <em>{situationDisplayLayerLabel(feature)}</em>
          {floodDetail ? null : <StatusBadge label={status.label} tone={status.tone} />}
        </div>
      </div>

      {isCommunityReport ? (
        <div className="community-report-actions">
          {linkedCommunityGroupId ? <button className="mini-button" onClick={() => onOpenChat?.(feature)} type="button">Chat</button> : null}
          <button className="mini-button" onClick={() => onEditReport?.(feature)} type="button">Upravit</button>
          <button className="mini-button danger" onClick={() => onDeleteReport?.(properties.reportId as string)} type="button">Smazat</button>
        </div>
      ) : null}

      <ObjectDetailSection title="Kontext">
        <DetailGrid
          rows={[
            [isCommunityReport ? "Typ" : "Vrstva", isCommunityReport ? communityReportCategoryDisplay(properties.category) : situationLayerLabel(properties.layer)],
            ...(isCommunityReport && legacyCommunityGroup ? [["Skupina", legacyCommunityGroup] as [string, React.ReactNode]] : []),
            ...(!isCommunityReport && !floodDetail ? [[weatherContext || weatherCamera ? "Typ" : "Kategorie", weatherCamera ? "Webkamera" : weatherContext ? weatherFeatureTypeLabel(feature) : properties.category] as [string, React.ReactNode]] : []),
            ["Zdroj", properties.sourceName ?? sourceDisplayName(properties.sourceId)],
            [isCommunityReport ? "Vloženo" : "Pozorováno", formatShortDateTime(properties.observedAt)],
            [isCommunityReport ? "Platnost" : "Platí do", formatShortDateTime(properties.validUntil)],
            ["Stáří", formatAge(properties.observedAt)],
            ...(!floodDetail ? [
              [isCommunityReport ? "Riziko" : "Naléhavost", communitySeverityDisplay(properties.hazardSeverity ?? properties.severity ?? properties.urgency)],
              ["Stav", <StatusBadge key="status" label={status.label} tone={status.tone} />]
            ] as Array<[string, React.ReactNode]> : []),
            ...(isCommunityReport || weatherContext || weatherCamera || floodDetail ? [] : [
              ["Účinné od", formatShortDateTime(properties.effectiveAt)],
              ["Konec platnosti", formatShortDateTime(properties.expiresAt)],
              ["Jistota", formatOptionalPercent(properties.confidence)],
              ["Spolehlivost", properties.certainty ?? "n/a"]
            ] as Array<[string, React.ReactNode]>)
          ]}
        />
      </ObjectDetailSection>

      {isMissionArenaFeature(feature) ? <MissionArenaSummary feature={feature} /> : null}
      {isSafetyLayerId(properties.layer) ? <SafetyRiskSummary authToken={authToken} feature={feature} /> : null}

      {properties.layer === "mobile_coverage" || properties.layer === "mobile_network" ? (
        <ObjectDetailSection title={properties.layer === "mobile_network" ? "Mobilní síť" : "Model mobilní sítě"}>
          {(() => {
            const mobile = mobileNetworkDisplayData(properties);
            return (
          <DetailGrid
            rows={[
              ["Režim", mobileNetworkOperationalModeLabel(mobile)],
              ["Podklad", mobileNetworkModelLabel(mobile)],
              ["Kvalita pokrytí", mobileCoverageQualityModel(mobile.quality).label],
              ["Stav modelu", formatMobileNetworkStatus(mobile.status)],
              ["Technologie", mobile.technology ?? "n/a"],
              ["Operátor", mobile.operator ?? "neznámý"],
              ["Stav BTS", mobileNetworkBtsStatusLabel(mobile)],
              ["Operátorský feed", formatAvailability(mobile.operatorStatusAvailable)],
              ["Jistota", formatOptionalPercent(mobile.confidence)],
              ["Kvalita dat", mobileNetworkDataQualityLabel(mobile.dataQuality)],
              ["Rozlišení modelu", formatOptionalNumber(mobile.resolutionM, " m")],
              ["Model", mobile.modelVersion ?? "n/a"],
              ["DEM", mobile.demSource ?? "n/a"],
              ["Terénní model", formatMobileTerrainState(mobile.assumptions)],
              ["Antény", formatMobileAntennaAssumptions(mobile.assumptions)],
              ["Datové podklady", mobileNetworkBasisLabels(mobile.basis)],
              ["Upozornění", mobileNetworkBtsStatusNotice(mobile.basis)],
              ["Poznámky", formatStringList(mobile.notices)],
              ["Shrnutí", mobile.summary ?? "n/a"],
              ["Revize modelu", formatMobileNetworkSourceRevision(mobile.sourceRevision)],
              ["Vygenerováno", formatShortDateTime(mobile.generatedAt)],
              ["Poznámka", mobile.disclaimer ?? "n/a"]
            ]}
          />
            );
          })()}
          <p className="mobile-model-explanation">{mobileNetworkModelExplanation(mobileNetworkDisplayData(properties))}</p>
        </ObjectDetailSection>
      ) : null}

      {properties.layer === "mobile_coverage" || properties.layer === "mobile_network" ? (
        <MobileNetworkTechnicalCoverageSection state={technicalCoverage} />
      ) : null}

      {isCommunicationTowerFeature(feature) ? (
        <ObjectDetailSection title="Komunikační stožár">
          <DetailGrid
            rows={[
              ["Typ", stringProperty(isRecord(properties.tags) ? properties.tags.towerType : undefined) ?? "communication"],
              ["OSM", formatOsmReference(isRecord(properties.tags) ? properties.tags : {})],
              ["Podklad", "referenční OSM infrastruktura"],
              ["Stav BTS", formatCommunicationTowerStatus(properties.btsStatus)],
              ["Operátorský stav", properties.operatorStatusAvailable ? "dostupný" : "není dostupný"],
              ["Licence", stringProperty(isRecord(properties.license) ? properties.license.attribution : undefined) ?? "OpenStreetMap contributors"],
              ["Poznámka", properties.disclaimer ?? "Jde o referenční OSM infrastrukturu, ne potvrzený realtime stav operátora."]
            ]}
          />
        </ObjectDetailSection>
      ) : null}
      {isCommunicationTowerFeature(feature) && mobileTowerViewshed ? (
        <MobileTowerViewshedSection state={mobileTowerViewshed} />
      ) : null}
      {properties.layer === "mobile" && !isCommunicationTowerFeature(feature) ? <MobileNetworkStatusSummary feature={feature} /> : null}
      {properties.layer === "traffic" ? <TrafficDetailSection feature={feature} /> : null}
      {isAviationWeatherFeature(feature) ? <AviationWeatherSummary feature={feature} /> : null}
      {weatherCamera ? <WeatherWebcamPreview authToken={authToken} feature={feature} /> : null}
      {weatherContext ? (
        <ObjectDetailSection title="Počasí">
          <WeatherContextSummary feature={feature} />
          <DetailGrid
            rows={weatherContextDetailRows(feature)}
          />
          <WeatherStationDetailPanel apiBase={apiBase} authToken={authToken} feature={feature} />
        </ObjectDetailSection>
      ) : null}
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
            ["Typ geometrie", feature.geometry.type],
            ["Souřadnice", formatSituationCoordinates(feature)]
          ]}
        />
      </ObjectDetailSection>

      <div className="object-flags">
        <span className="situation-badge">KONTEXT</span>
        {isSafetyLayerId(properties.layer) ? <span className="warning-badge">VÝSTRAŽNÁ VRSTVA</span> : null}
        {properties.layer === "mobile_network" && isMobileNetworkModelEstimate(properties) ? <span className="warning-badge">MODELOVÝ ODHAD</span> : null}
        {properties.stale ? <span className="warning-badge">STARŠÍ DATA</span> : null}
        {properties.severity ? <span className="warning-badge">{communitySeverityDisplay(properties.severity)}</span> : null}
      </div>
    </div>
  );
}

function MobileNetworkTechnicalCoverageSection({ state }: { state: MobileTechnicalCoverageState }) {
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "loading") {
    return (
      <ObjectDetailSection title="Technický kontext pokrytí">
        <div className="empty-mini">Načítám LoS/DEM detail modelu pokrytí ze SIM.</div>
      </ObjectDetailSection>
    );
  }
  if (state.status === "error") {
    return (
      <ObjectDetailSection title="Technický kontext pokrytí">
        <div className="situation-warning">Technický detail pokrytí není dostupný: {state.error}</div>
      </ObjectDetailSection>
    );
  }
  if (!state.feature) {
    return (
      <ObjectDetailSection title="Technický kontext pokrytí">
        <div className="empty-mini">SIM pro tuto buňku nevrátila odpovídající technický LoS/DEM detail.</div>
        {state.warnings.map((warning) => <div className="situation-warning" key={warning}>{warning}</div>)}
      </ObjectDetailSection>
    );
  }
  const properties = state.feature.properties;
  const metrics = isRecord(properties.metrics) ? properties.metrics : {};
  const assumptions = isRecord(properties.assumptions) ? properties.assumptions : {};
  return (
    <ObjectDetailSection title="Technický kontext pokrytí">
      <DetailGrid
        rows={[
          ["Zdroj detailu", properties.sourceName ?? sourceDisplayName(properties.sourceId)],
          ["Vrstva detailu", situationLayerLabel(properties.layer)],
          ["Model", properties.modelVersion ?? "n/a"],
          ["Technologie", properties.technology ?? "n/a"],
          ["DEM", properties.demSource ?? stringProperty(assumptions.demSource) ?? "n/a"],
          ["Terén použit", formatBooleanLike(assumptions.terrainApplied)],
          ["Propagační model", stringProperty(assumptions.propagationModel) ?? "n/a"],
          ["Útlum terénu", formatOptionalNumber(recordNumber(metrics, "terrainPenaltyDb"), " dB")],
          ["Max. překážka terénu", formatOptionalNumber(recordNumber(metrics, "terrainMaxObstructionM"), " m")],
          ["Vzdálenost k BTS", formatOptionalNumber(recordNumber(metrics, "distanceToNearestTowerM"), " m")],
          ["Výška BTS", formatOptionalNumber(recordNumber(metrics, "towerElevationM"), " m n. m.")],
          ["Výška cíle", formatOptionalNumber(recordNumber(metrics, "targetElevationM"), " m n. m.")],
          ["LoS vzorky", formatOptionalInteger(recordNumber(metrics, "terrainSamples"))]
        ]}
      />
      {state.warnings.map((warning) => <div className="situation-warning" key={warning}>{warning}</div>)}
    </ObjectDetailSection>
  );
}

function MobileTowerViewshedSection({ state }: { state: MobileTowerViewshedState }) {
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "loading") {
    return (
      <ObjectDetailSection title="Modelovaný dosah BTS">
        <div className="empty-mini">Načítám sektorový odhad rádiového dosahu vybrané BTS ze SIM.</div>
      </ObjectDetailSection>
    );
  }
  if (state.status === "error") {
    return (
      <ObjectDetailSection title="Modelovaný dosah BTS">
        <div className="situation-warning">Modelovaný dosah BTS není dostupný: {state.error}</div>
      </ObjectDetailSection>
    );
  }

  const tower = isRecord(state.response.tower) ? state.response.tower : {};
  const summary = isRecord(state.response.summary) ? state.response.summary : {};
  const firstFeature = state.features[0];
  const firstProperties: Record<string, unknown> = firstFeature ? firstFeature.properties as unknown as Record<string, unknown> : {};
  const firstAssumptions = isRecord(firstProperties.assumptions) ? firstProperties.assumptions : {};
  const metricRecords = state.features
    .map((feature) => isRecord(feature.properties.metrics) ? feature.properties.metrics : {})
    .filter((record) => Object.keys(record).length > 0);
  const disclaimer = stringProperty(summary.disclaimer)
    ?? stringProperty(firstProperties.disclaimer)
    ?? "Mobilní pokrytí je modelový odhad SIM. Stav konkrétní BTS není potvrzen autorizovaným operátorským/NOC feedem.";

  return (
    <ObjectDetailSection title="Modelovaný dosah BTS">
      <DetailGrid
        rows={[
          ["Tower ID", state.towerId],
          ["Technologie", state.technology],
          ["Sektory", formatOptionalInteger(state.features.length)],
          ["Stav BTS", stringProperty(tower.btsStatus) ?? stringProperty(firstProperties.btsStatus) ?? "operator_feed_unavailable"],
          ["Operátorský feed", formatAvailability(booleanProperty(tower.operatorStatusAvailable) ?? booleanProperty(firstProperties.operatorStatusAvailable))],
          ["Model", stringProperty(summary.modelVersion) ?? stringProperty(firstProperties.modelVersion) ?? "n/a"],
          ["Sektorový model", formatBooleanLike(firstAssumptions.sectorAware)],
          ["RF plán operátora", formatBooleanLike(firstAssumptions.operatorRfPlanAvailable)],
          ["Útlum terénu", formatNumberRangeFromRecords(metricRecords, "terrainPenaltyDb", " dB")],
          ["Max. překážka terénu", formatNumberRangeFromRecords(metricRecords, "terrainMaxObstructionM", " m")],
          ["Čistá LoS", formatViewshedLosSummary(state.features)],
          ["Upozornění", formatStringList(state.response.warnings)],
          ["Poznámka", disclaimer]
        ]}
      />
    </ObjectDetailSection>
  );
}

function formatNumberRangeFromRecords(records: Array<Record<string, unknown>>, key: string, unit: string): string {
  const values = records
    .map((record) => recordNumber(record, key))
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) {
    return "n/a";
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (Math.abs(max - min) < 0.05) {
    return formatOptionalNumber(min, unit);
  }
  return `${formatOptionalNumber(min, unit)} - ${formatOptionalNumber(max, unit)}`;
}

function formatViewshedLosSummary(features: SituationFeature[]): string {
  const values = features
    .map((feature) => {
      const assumptions = isRecord(feature.properties.assumptions) ? feature.properties.assumptions : {};
      return booleanProperty(assumptions.lineOfSightClear);
    })
    .filter((value): value is boolean => value !== undefined);
  if (values.length === 0) {
    return "n/a";
  }
  const clearCount = values.filter(Boolean).length;
  const blockedCount = values.length - clearCount;
  return `${clearCount} čistá / ${blockedCount} blokovaná`;
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
        const previewUrl = communityAttachmentPreviewUrl(attachment);
        const xrVideoUrl = buildXrVideoUrl(attachment);
        const xrDerivativeStatus = communityAttachmentXrDerivativeStatus(attachment);
        const photoUrl = attachment.kind === "photo" ? attachment.contentUrl ?? previewUrl : undefined;
        const videoPosterUrl = attachment.kind === "video" ? previewUrl : undefined;
        const documentPreviewUrl = attachment.kind === "document" ? previewUrl : undefined;
        return (
          <div className="community-media-item" key={attachment.attachmentId}>
            <div className="community-media-meta">
              <strong>{attachment.fileName ?? communityAttachmentKindLabel(attachment.kind)}</strong>
              <span>{communityAttachmentKindLabel(attachment.kind)} · {formatFileSize(attachment.byteSize)}</span>
            </div>
            {photoUrl ? (
              <button className="community-media-open" onClick={() => onOpenGallery?.(attachments, index)} type="button">
                <img alt={attachment.fileName ?? "Fotografie hlášení"} src={photoUrl} />
              </button>
            ) : null}
            {attachment.kind === "video" && (attachment.contentUrl || videoPosterUrl) ? (
              <>
                <button className="community-media-open community-video-preview-button" onClick={() => onOpenGallery?.(attachments, index)} type="button">
                  {attachment.contentUrl ? (
                    <video muted playsInline preload="metadata" src={communityVideoPreviewUrl(attachment.contentUrl)} />
                  ) : videoPosterUrl ? (
                    <img alt={attachment.fileName ?? "Video hlášení"} src={videoPosterUrl} />
                  ) : null}
                  <span className="community-video-preview-overlay" aria-hidden="true">
                    <Play size={22} />
                    <strong>Přehrát video</strong>
                  </span>
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
            {attachment.kind === "document" ? (
              <button className="community-document-preview-card" onClick={() => onOpenGallery?.(attachments, index)} type="button">
                {documentPreviewUrl ? <img alt={attachment.fileName ?? "PDF příloha"} src={documentPreviewUrl} /> : <FileText size={30} />}
                <span>
                  <strong>{attachment.fileName ?? "PDF příloha"}</strong>
                  <small>{attachment.contentUrl ? "Otevřít PDF" : "Demo náhled dokumentu"}</small>
                </span>
              </button>
            ) : null}
            {!attachment.contentUrl && !previewUrl ? (
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
  return [designator, manufacturer, model].filter(Boolean).join(" / ") || "neuvedeno";
}

function displayValue(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : "neuvedeno";
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
  const stale = flightData.quality?.stale ? "starší data" : "aktuální";
  const age = typeof flightData.quality?.positionAgeSeconds === "number" ? `${flightData.quality.positionAgeSeconds}s` : "stáří není dostupné";
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
    return <div className="empty-mini">Historie zatím nemá body pro tento objekt.</div>;
  }

  return (
    <div className="object-history-list">
      {history.map((entry) => (
        <div className="object-history-row" key={`${entry.timestamp}-${entry.eventId ?? entry.sourceSystemId ?? "point"}`}>
          <strong>{formatShortDateTime(entry.timestamp)}</strong>
          <span>{entry.sourceSystemId ?? "zdroj není dostupný"}</span>
          <small>
            {entry.status ? objectStatusLabel(entry.status) : "stav není dostupný"} · {entry.confidence === undefined ? "jistota není dostupná" : `${Math.round(entry.confidence * 100)} %`} ·{" "}
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

function webPushStatusLabel(state: WebPushUiState): string {
  if (state.registered) {
    return "zapnuto";
  }
  switch (state.status) {
    case "available":
      return "připraveno";
    case "degraded":
      return "omezeno";
    case "disabled":
      return "vypnuto";
    case "permission-denied":
      return "zakázáno prohlížečem";
    case "unsupported":
      return "nepodporováno";
    case "registered":
      return "zapnuto";
    default:
      return "čekám";
  }
}

function webPushStatusTone(state: WebPushUiState): "ok" | "warn" | "neutral" {
  if (state.registered) {
    return "ok";
  }
  if (state.status === "degraded" || state.status === "permission-denied") {
    return "warn";
  }
  return "neutral";
}

function webPushPermissionLabel(permission: NotificationPermission | "unsupported"): string {
  switch (permission) {
    case "granted":
      return "povoleno";
    case "denied":
      return "zakázáno";
    case "default":
      return "čeká na povolení";
    default:
      return "nepodporováno";
  }
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
  { label: "Vybraní uživatelé", value: "users" }
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

function formatOperationStatusLabel(status: unknown): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    active: "aktivní",
    advisory: "informace",
    critical: "kritické",
    degraded: "omezeno",
    expired: "po platnosti",
    info: "informace",
    online: "online",
    ready: "připraveno",
    risk: "riziko",
    stale: "starší data",
    warning: "varování",
    zivě: "živě",
    "živě": "živě"
  };
  return labels[normalized] ?? (normalized ? normalized : "čekám");
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
    mediaAccessMode: "public",
    mediaAccessUserSubjectIds: "",
    title: "",
    validUntil: toDateTimeLocalValue(new Date(Date.now() + 2 * 60 * 60 * 1000)),
    videoSpatialMode: "none"
  };
}

function communityReportChatGroupName(title: string): string {
  const normalized = title.trim().replace(/\s+/gu, " ");
  const base = normalized || "Událost v mapě";
  const prefixed = base.toLocaleLowerCase("cs-CZ").startsWith("událost:")
    ? base
    : `Událost: ${base}`;
  return truncateText(prefixed, 120);
}

function communityReportChatGroupDescription(draft: CommunityReportDraft): string {
  const category = communityReportCategoryLabelForValue(draft.category);
  const severity = communitySeverityDisplay(draft.hazardSeverity);
  const description = draft.description.trim();
  return truncateText(
    [category, severity, description].filter(Boolean).join(" · "),
    280
  );
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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

function communityVideoPreviewUrl(contentUrl: string): string {
  if (contentUrl.includes("#")) {
    return contentUrl;
  }
  return `${contentUrl}#t=0.1`;
}

function communityAttachmentPreviewUrl(attachment: { metadata?: Record<string, unknown> }): string | undefined {
  const metadata = attachment.metadata ?? {};
  const value = stringProperty(metadata.demoPreviewUrl)
    ?? stringProperty(metadata.previewUrl)
    ?? stringProperty(metadata.thumbnailUrl)
    ?? stringProperty(metadata.demoContentUrl);
  return value && /^(data:image\/|\/api\/v1\/community\/|https:\/\/)/u.test(value) ? value : undefined;
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

function summarizeSafetyAlerts(features: SituationFeature[]): AlertSummary {
  return {
    critical: features.filter((feature) => priorityFeatureSeverityRank(feature) >= 3).length,
    local: 0,
    server: features.length,
    total: features.length,
    warning: features.filter((feature) => priorityFeatureSeverityRank(feature) === 2).length
  };
}

function summarizeTechnicalAlerts(alerts: CopAlert[]): TechnicalAlertSummary {
  const activeAlerts = alerts.filter((alert) => alert.status === "ACTIVE");
  return {
    conflicts: activeAlerts.filter((alert) => alert.type === "TRACK_CONFLICT" || alert.type === "AOI_ENTRY").length,
    lifecycle: activeAlerts.filter((alert) => alert.type === "TRACK_LOST" || alert.type === "TRACK_STALE").length,
    lowConfidence: activeAlerts.filter((alert) => alert.type === "LOW_CONFIDENCE").length,
    sourceDegraded: activeAlerts.filter((alert) => alert.type === "SOURCE_DEGRADED").length,
    total: activeAlerts.length
  };
}

function filterPublicSafetyAlertFeatures(features: SituationFeature[]): SituationFeature[] {
  return features.filter(isPublicSafetyAlertFeature);
}

interface PriorityAlertInput {
  alerts: CopAlert[];
  features: SituationFeature[];
  mapView: MapViewState | undefined;
  objects: CopObject[];
  proximityAlerts: ProximityAlert[];
  userLocation: UserLocation | null;
}

export function buildPriorityAlertSummary({
  features,
  mapView,
  userLocation
}: PriorityAlertInput): PriorityAlertSummary {
  const reference = priorityAlertReference(userLocation, mapView);
  const now = Date.now();
  const candidates = filterPublicSafetyAlertFeatures(features)
    .flatMap((feature) => priorityCandidateFromSituationFeature(feature, reference, now))
    .sort(priorityAlertCandidateComparator);

  return {
    additionalCount: Math.max(0, candidates.length - 1),
    primary: candidates[0] ?? null,
    reference,
    total: candidates.length
  };
}

function priorityAlertReference(
  userLocation: UserLocation | null,
  mapView: MapViewState | undefined
): PriorityAlertSummary["reference"] {
  if (userLocation) {
    return { lat: userLocation.lat, lon: userLocation.lon, source: "user" };
  }
  if (mapView) {
    const [lon, lat] = mapView.center;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon, source: "map" };
    }
  }
  return { ...defaultAoiCenter, source: "default" };
}

function priorityCandidateFromSituationFeature(
  feature: SituationFeature,
  reference: { lat: number; lon: number },
  now: number
): PriorityAlertCandidate[] {
  if (!isPrioritySituationFeature(feature)) {
    return [];
  }
  const severityRank = priorityFeatureSeverityRank(feature);
  if (severityRank <= 0) {
    return [];
  }
  const validUntil = feature.properties.validUntil ?? feature.properties.expiresAt;
  const location = situationFeatureReferencePoint(feature);
  const distanceKm = location ? distanceBetweenKm(reference, location) : undefined;
  const status = situationFeatureStatusModel(feature);
  const detail = [
    status.label,
    formatPriorityAlertDistance(distanceKm),
    feature.properties.areaName,
    sourceDisplayName(feature.properties.sourceId)
  ].filter((value) => value && value !== "neznámá vzdálenost").join(" · ");
  const candidate = createPriorityAlertCandidate({
    badge: priorityFeatureBadge(feature),
    confidence: priorityFeatureConfidence(feature),
    detail,
    distanceKm,
    id: `feature:${feature.properties.featureId}`,
    observedAt: latestTimestamp([
      feature.properties.observedAt,
      feature.properties.effectiveAt,
      feature.properties.validFrom,
      feature.properties.updatedAt,
      feature.properties.generatedAt
    ]),
    severityRank,
    sourceKind: "feature",
    title: priorityFeatureTitle(feature),
    tone: priorityToneFromSeverityRank(severityRank),
    validUntil
  }, now);
  return candidate ? [candidate] : [];
}

function createPriorityAlertCandidate(
  candidate: Omit<PriorityAlertCandidate, "score">,
  now: number
): PriorityAlertCandidate | null {
  if (isPriorityAlertExpired(candidate.validUntil, now)) {
    return null;
  }
  const confidence = clamp(candidate.confidence, 0, 1);
  const score = priorityAlertScore({
    confidence,
    distanceKm: candidate.distanceKm,
    observedAt: candidate.observedAt,
    severityRank: candidate.severityRank
  }, now);
  return { ...candidate, confidence, score };
}

function priorityAlertScore(
  candidate: Pick<PriorityAlertCandidate, "confidence" | "distanceKm" | "observedAt" | "severityRank">,
  now: number
): number {
  const boundedDistance = candidate.distanceKm === undefined ? 260 : Math.min(Math.max(candidate.distanceKm, 0), 260);
  const distanceScore = (260 - boundedDistance) * 1_000;
  const severityScore = candidate.severityRank * 120;
  const confidenceScore = candidate.confidence * 60;
  const observedTime = candidate.observedAt ? Date.parse(candidate.observedAt) : Number.NaN;
  const ageHours = Number.isFinite(observedTime) ? Math.max(0, (now - observedTime) / 3_600_000) : 48;
  const recencyScore = Math.max(0, 48 - Math.min(ageHours, 48));
  return distanceScore + severityScore + confidenceScore + recencyScore;
}

function priorityAlertCandidateComparator(a: PriorityAlertCandidate, b: PriorityAlertCandidate): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (b.severityRank !== a.severityRank) {
    return b.severityRank - a.severityRank;
  }
  return (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);
}

function isPriorityAlertExpired(validUntil: string | undefined, now: number): boolean {
  if (!validUntil) {
    return false;
  }
  const timestamp = Date.parse(validUntil);
  return Number.isFinite(timestamp) && timestamp < now;
}

function isPrioritySituationFeature(feature: SituationFeature): boolean {
  const layer = feature.properties.layer;
  if (!isPublicSafetyAlertFeature(feature)) {
    return false;
  }
  if (layer === "warnings" || layer === "weather_alerts" || layer === "fire" || layer === "community") {
    return priorityFeatureSeverityRank(feature) > 0;
  }
  if (layer === "flood") {
    const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
    const floodStage = safetyMetricNumber(feature.properties, metrics, "floodStage", "floodActivityLevel");
    return (floodStage ?? 0) > 0 || feature.properties.trend === "rising" || priorityFeatureSeverityRank(feature) >= 2;
  }
  if (isWeatherContextFeature(feature)) {
    return priorityFeatureSeverityRank(feature) >= 2;
  }
  return priorityFeatureSeverityRank(feature) >= 2;
}

function isPublicSafetyAlertFeature(feature: SituationFeature): boolean {
  const layer = feature.properties.layer;
  if (!isPublicSafetyAlertLayerId(layer)) {
    return false;
  }
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return stringProperty(tags.dataSource) === "safety-data";
}

function isPublicSafetyAlertLayerId(value: string | undefined): boolean {
  return typeof value === "string" && publicSafetyAlertLayerIds.has(value);
}

function priorityFeatureSeverityRank(feature: SituationFeature): number {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const status = situationFeatureStatusModel(feature);
  const rawRank = Math.max(
    prioritySeverityValueRank(feature.properties.hazardSeverity),
    prioritySeverityValueRank(feature.properties.severity),
    prioritySeverityValueRank(feature.properties.urgency),
    prioritySeverityValueRank(feature.properties.status),
    prioritySeverityValueRank(stringProperty(tags.status)),
    prioritySeverityValueRank(stringProperty(metrics.status))
  );
  if (feature.properties.layer === "flood") {
    const floodStage = safetyMetricNumber(feature.properties, metrics, "floodStage", "floodActivityLevel") ?? 0;
    if (floodStage >= 3) {
      return 3;
    }
    if (floodStage >= 1) {
      return 2;
    }
    if (feature.properties.trend === "rising") {
      return Math.max(rawRank, 1);
    }
  }
  if (feature.properties.layer === "fire") {
    const fireRank = prioritySeverityValueRank(safetyCanonicalTypeCode(feature.properties) ?? feature.properties.fireStatus ?? feature.properties.sourceIncident);
    return Math.max(rawRank, fireRank, 2);
  }
  if (feature.properties.layer === "community") {
    return Math.max(rawRank, prioritySeverityValueRank(feature.properties.hazardSeverity), 1);
  }
  if (isWeatherContextFeature(feature)) {
    return Math.max(rawRank, priorityToneRank(weatherFeatureTone(feature)), feature.properties.layer === "weather_thunderstorm_risk" ? 2 : 0);
  }
  if (feature.properties.layer === "warnings" || feature.properties.layer === "weather_alerts") {
    return Math.max(rawRank, priorityToneRank(status.tone), 2);
  }
  return Math.max(rawRank, priorityToneRank(status.tone));
}

function prioritySeverityValueRank(value: unknown): number {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!normalized) {
    return 0;
  }
  if (["critical", "crit", "severe", "extreme", "danger", "emergency", "high", "very high", "3", "4"].includes(normalized)) {
    return 3;
  }
  if (["warning", "warn", "advisory", "watch", "moderate", "medium", "risk", "rising", "2"].includes(normalized)) {
    return 2;
  }
  if (["info", "information", "notice", "low", "limited", "minor", "1"].includes(normalized)) {
    return 1;
  }
  if (normalized.includes("critical") || normalized.includes("extreme") || normalized.includes("severe") || normalized.includes("hotspot") || normalized.includes("active")) {
    return 3;
  }
  if (normalized.includes("warning") || normalized.includes("advisory") || normalized.includes("risk") || normalized.includes("fire") || normalized.includes("storm") || normalized.includes("flood")) {
    return 2;
  }
  return 0;
}

function priorityFeatureConfidence(feature: SituationFeature): number {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  return numberProperty(feature.properties.confidence) ?? recordNumber(metrics, "confidence") ?? 0.8;
}

function priorityFeatureBadge(feature: SituationFeature): string {
  switch (feature.properties.layer) {
    case "community":
      return "Hlášení";
    case "fire":
      return "Požár";
    case "flood":
      return "Hydrologie";
    case "weather":
    case "weather_alerts":
    case "weather_precipitation_grid":
    case "weather_radar_nowcast":
    case "weather_radar_precipitation":
    case "weather_radar_reflectivity":
    case "weather_thunderstorm_risk":
    case "weather_wind_field":
      return "Počasí";
    case "warnings":
      return "Výstraha";
    default:
      return "Riziko";
  }
}

function priorityFeatureTitle(feature: SituationFeature): string {
  if (isWeatherContextFeature(feature) && !isAviationWeatherFeature(feature)) {
    return weatherFeatureHeadline(feature);
  }
  return safetyDisplayLabel(feature.properties)
    ?? feature.properties.areaName
    ?? feature.properties.label
    ?? feature.properties.featureId;
}

function situationFeatureReferencePoint(feature: SituationFeature): { lat: number; lon: number } | undefined {
  const coordinates = collectSituationGeometryPoints(feature.geometry);
  if (coordinates.length === 0) {
    return undefined;
  }
  const lats = coordinates.map((coordinate) => coordinate.lat);
  const lons = coordinates.map((coordinate) => coordinate.lon);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2
  };
}

function collectSituationGeometryPoints(geometry: SituationFeature["geometry"]): Array<{ lat: number; lon: number }> {
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    return Number.isFinite(lat) && Number.isFinite(lon) ? [{ lat, lon }] : [];
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates.flatMap(([lon, lat]) => Number.isFinite(lat) && Number.isFinite(lon) ? [{ lat, lon }] : []);
  }
  if (geometry.type === "Polygon") {
    return geometry.coordinates.flatMap((ring) =>
      ring.flatMap(([lon, lat]) => Number.isFinite(lat) && Number.isFinite(lon) ? [{ lat, lon }] : [])
    );
  }
  return geometry.coordinates.flatMap((polygon) =>
    polygon.flatMap((ring) =>
      ring.flatMap(([lon, lat]) => Number.isFinite(lat) && Number.isFinite(lon) ? [{ lat, lon }] : [])
    )
  );
}

function priorityToneRank(tone: PriorityAlertTone): number {
  if (tone === "critical") {
    return 3;
  }
  if (tone === "warn") {
    return 2;
  }
  if (tone === "ok") {
    return 1;
  }
  return 0;
}

function priorityToneFromSeverityRank(rank: number): PriorityAlertTone {
  if (rank >= 3) {
    return "critical";
  }
  if (rank >= 2) {
    return "warn";
  }
  if (rank >= 1) {
    return "neutral";
  }
  return "ok";
}

function formatPriorityAlertDistance(distanceKm: number | undefined): string {
  if (distanceKm === undefined || !Number.isFinite(distanceKm)) {
    return "neznámá vzdálenost";
  }
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1_000)} m`;
  }
  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} km`;
  }
  return `${Math.round(distanceKm)} km`;
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
  loadError,
  objects,
  replayActive,
  sources,
  visibleObjects
}: {
  loadError: string | null;
  objects: CopObject[];
  replayActive: boolean;
  sources: SourceSystem[];
  visibleObjects: CopObject[];
}): string | null {
  if (loadError) {
    return `API situační mapy není dostupné: ${loadError}`;
  }
  if (replayActive && objects.length === 0) {
    return "Zvolený čas neobsahuje žádné objekty. Posuňte časovou osu nebo přepněte zpět na živé zobrazení.";
  }
  if (objects.length > 0 && visibleObjects.length === 0) {
    return null;
  }
  if (hasActiveSimSource(sources)) {
    return null;
  }
  if (sources.length > 0) {
    return null;
  }
  return null;
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
      title: `${objectStatusLabel(object.status)} / ${object.objectType}`,
      detail: `${object.objectId} · ${affiliation.label} · jistota ${confidence} %`,
      tone: affiliation.disposition
    };
  });
}

function sourceHealthLabel(status: SourceHealthItem["health"]): string {
  const labels: Record<SourceHealthItem["health"], string> = {
    DEGRADED: "omezeno",
    DISABLED: "vypnuto",
    ONLINE: "online",
    QUIET: "bez nových dat",
    STALE: "starší data",
    UNAVAILABLE: "nedostupné",
    WAITING: "čeká"
  };
  return labels[status];
}

function sourceRegistryStatusLabel(status: string | undefined): string {
  const normalized = status?.toUpperCase();
  if (normalized === "ACTIVE") {
    return "aktivní";
  }
  if (normalized === "DISABLED") {
    return "vypnutý";
  }
  if (normalized === "REGISTERED") {
    return "registrovaný";
  }
  if (normalized === "DEGRADED") {
    return "omezený";
  }
  return "čeká";
}

function sourceHealthSummary(items: SourceHealthItem[], sourceKey: string): string {
  const item = findSourceHealth(items, sourceKey);
  if (!item) {
    return "čeká";
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
    air_quality_grid: "Kvalita ovzduší - plocha",
    boundary_admin: "Správní hranice",
    boundary_country: "Stát",
    boundary_district: "Okresy",
    boundary_municipality: "Obce",
    boundary_orp: "ORP",
    boundary_region: "Kraje",
    community: "Komunitní hlášení",
    fire: "Požáry",
    flight_airports: "Letiště",
    flight_airspaces: "Letecké prostory",
    flood: "Vodní stavy",
    ground: "Terén",
    mobile: "Mobilní síť",
    mobile_coverage: "Model mobilní sítě",
    mobile_network: "Mobilní síť",
    mission_arena: "Mission Arena",
    place_settlements: "Sídla",
    traffic: "Doprava",
    warnings: "Výstrahy",
    weather_alerts: "Meteorologické výstrahy",
    weather: "Počasí",
    weather_webcams: "Webkamery ČHMÚ",
    weather_humidity_grid: "Vlhkost",
    weather_precipitation_grid: "Srážky",
    weather_pressure_grid: "Tlak",
    weather_radar_nowcast: "Radarový nowcast",
    weather_radar_precipitation: "Radarové srážky",
    weather_radar_reflectivity: "Radarová odrazivost",
    weather_temperature_grid: "Teplota",
    weather_thunderstorm_risk: "Bouřkové riziko",
    weather_wind_field: "Vítr"
  };
  return labels[layerId];
}

function situationDisplayLayerLabel(feature: SituationFeature): string {
  if (isTakGatewayFeature(feature)) {
    return `TAK Gateway > ${takLayerLabel(feature.properties.layer as TakLayerId)}`;
  }
  if (isWeatherWebcamFeature(feature)) {
    return "Webkamery ČHMÚ";
  }
  return situationLayerLabel(feature.properties.layer);
}

function safetyLayerLabel(layerId: SafetyLayerId): string {
  const labels: Record<SafetyLayerId, string> = {
    boundary_admin: "Správní hranice",
    fire: "Požáry",
    flood: "Vodní stavy a průtoky",
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
    degraded: "omezeno",
    disabled: "vypnuto",
    loading: "načítám",
    online: "online",
    zoom: "přiblížit"
  };
  return labels[status];
}

function catalogLayerStatusLabel(status: SituationLayerStatus): string {
  if (status === "disabled") {
    return "zdroj nedostupný";
  }
  return situationStatusLabel(status);
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
    return "přiblížit";
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

function formatOptionalPercentFromWhole(value: number | undefined, fallbackRatio?: number): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.round(value)} %`;
  }
  return formatOptionalPercent(fallbackRatio);
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

function formatAvailability(value: boolean | undefined): string {
  if (value === true) {
    return "dostupný";
  }
  if (value === false) {
    return "není dostupný";
  }
  return "n/a";
}

function formatBooleanLike(value: unknown): string {
  if (value === true || value === "true") {
    return "ano";
  }
  if (value === false || value === "false") {
    return "ne";
  }
  return stringProperty(value) ?? "n/a";
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
    return feature.properties.stale && coverage.tone === "ok" ? { label: `${coverage.label} · starší data`, tone: "warn" } : coverage;
  }
  if (isCommunicationTowerFeature(feature)) {
    return { label: "REFERENČNÍ", tone: "neutral" };
  }
  if (isWeatherWebcamFeature(feature)) {
    return { label: "KAMERA", tone: "neutral" };
  }
  if (feature.properties.stale) {
    return { label: "starší data", tone: "warn" };
  }
  if (feature.properties.layer === "flood") {
    const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
    const floodStage = safetyMetricNumber(feature.properties, metrics, "floodStage", "floodActivityLevel");
    if (floodStage !== undefined) {
      return floodStageStatusModel(floodStage);
    }
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

function isWeatherContextFeature(feature: SituationFeature): boolean {
  return feature.properties.layer === "weather"
    || feature.properties.layer === "weather_temperature_grid"
    || feature.properties.layer === "weather_wind_field"
    || feature.properties.layer === "weather_precipitation_grid"
    || feature.properties.layer === "weather_humidity_grid"
    || feature.properties.layer === "weather_pressure_grid"
    || feature.properties.layer === "weather_radar_reflectivity"
    || feature.properties.layer === "weather_radar_precipitation"
    || feature.properties.layer === "weather_radar_nowcast"
    || feature.properties.layer === "weather_thunderstorm_risk";
}

interface WeatherCameraInfo {
  detailUrl?: string;
  direction?: string;
  label?: string;
  observedAt?: string;
  snapshotUrl?: string;
}

interface WeatherWebcamDetail {
  cameras: WeatherCameraInfo[];
  generatedAt?: string;
  location?: {
    label?: string;
    lat?: number;
    lon?: number;
  };
}

interface WeatherWebcamDetailCacheEntry {
  detail?: WeatherWebcamDetail;
  locationLabel?: string;
  status: "error" | "loading" | "ready";
}

function isWeatherWebcamFeature(feature: SituationFeature): boolean {
  const camera = weatherWebcamProviderMetadata(feature);
  const category = normalizeSituationCategory(feature.properties.category);
  const providerLayerId = stringProperty(feature.properties.providerLayerId);
  return feature.properties.layerId === "public.weather.webcams"
    || feature.properties.sourceId === "chmi_weather_webcams"
    || providerLayerId === "weather.webcams"
    || providerLayerId === "weather_webcams"
    || providerLayerId === "chmi_weather_webcams"
    || category === "weather_webcam"
    || category === "webcam"
    || Boolean(stringProperty(camera.detailUrl) || stringProperty(camera.snapshotUrl));
}

function weatherWebcamProviderMetadata(feature: SituationFeature): Record<string, unknown> {
  const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
  return isRecord(providerProperties.camera) ? providerProperties.camera : {};
}

function weatherWebcamMetadata(feature: SituationFeature): WeatherCameraInfo {
  const camera = weatherWebcamProviderMetadata(feature);
  return {
    detailUrl: stringProperty(camera.detailUrl) ?? feature.properties.detailUrl,
    direction: stringProperty(camera.direction) ?? stringProperty(camera.orientation),
    label: stringProperty(camera.label)
      ?? stringProperty(camera.name)
      ?? stringProperty(camera.title)
      ?? feature.properties.headline
      ?? feature.properties.label
      ?? "Webkamera ČHMÚ",
    observedAt: stringProperty(camera.observedAt) ?? feature.properties.observedAt,
    snapshotUrl: stringProperty(camera.snapshotUrl)
      ?? stringProperty(camera.imageUrl)
      ?? stringProperty(camera.previewUrl)
      ?? stringProperty(camera.url)
  };
}

function normalizeWeatherWebcamDetail(value: unknown): WeatherWebcamDetail {
  const root = isRecord(value) ? value : {};
  const location = isRecord(root.location) ? root.location : {};
  const camerasValue = Array.isArray(root.cameras)
    ? root.cameras
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(root.data)
        ? root.data
        : [];
  return {
    cameras: camerasValue.flatMap((entry, index) => {
      const camera = normalizeWeatherCameraInfo(entry, `Kamera ${index + 1}`);
      return camera ? [camera] : [];
    }),
    generatedAt: stringProperty(root.generatedAt) ?? stringProperty(root.updatedAt),
    location: {
      label: stringProperty(location.label) ?? stringProperty(location.name) ?? stringProperty(root.label),
      lat: numberProperty(location.lat),
      lon: numberProperty(location.lon)
    }
  };
}

function normalizeWeatherCameraInfo(value: unknown, fallbackLabel: string): WeatherCameraInfo | null {
  if (!isRecord(value)) {
    return null;
  }
  const snapshotUrl = stringProperty(value.snapshotUrl)
    ?? stringProperty(value.imageUrl)
    ?? stringProperty(value.previewUrl)
    ?? stringProperty(value.url);
  const detailUrl = stringProperty(value.detailUrl);
  const label = stringProperty(value.label)
    ?? stringProperty(value.name)
    ?? stringProperty(value.title)
    ?? stringProperty(value.cameraId)
    ?? fallbackLabel;
  if (!snapshotUrl && !detailUrl) {
    return null;
  }
  return {
    detailUrl,
    direction: stringProperty(value.direction) ?? stringProperty(value.orientation),
    label,
    observedAt: stringProperty(value.observedAt) ?? stringProperty(value.updatedAt) ?? stringProperty(value.timestamp),
    snapshotUrl
  };
}

function weatherWebcamCandidates(fallback: WeatherCameraInfo, detail: WeatherWebcamDetail | null): WeatherCameraInfo[] {
  const detailCameras = (detail?.cameras ?? []).filter((camera) => camera.snapshotUrl || camera.detailUrl);
  const candidates = detailCameras.length > 0 ? detailCameras : [fallback].filter((camera) => camera.snapshotUrl || camera.detailUrl);
  return uniqueWeatherCameras(candidates);
}

function uniqueWeatherCameras(candidates: WeatherCameraInfo[]): WeatherCameraInfo[] {
  const seen = new Set<string>();
  return candidates.filter((camera) => {
    const key = camera.snapshotUrl ?? camera.detailUrl ?? weatherCameraBaseLocationName(camera.label) ?? camera.label ?? "";
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function weatherWebcamTitle(feature: SituationFeature): string {
  return normalizeWeatherWebcamDisplayLabel(weatherWebcamMetadata(feature).label ?? "Webkamera ČHMÚ");
}

function normalizeWeatherWebcamDisplayLabel(label: string): string {
  const trimmed = label.replace(/\s+/g, " ").trim();
  return isGenericWeatherWebcamLabel(trimmed) ? "Webkamera ČHMÚ" : trimmed;
}

function isGenericWeatherWebcamLabel(label: string | undefined): boolean {
  const normalized = label?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length === 0 || /^ČHMÚ webkamera\s+[-+]?\d/i.test(normalized);
}

function weatherCameraBaseLocationName(label: string | undefined): string | undefined {
  const normalized = stringProperty(label);
  if (!normalized || isGenericWeatherWebcamLabel(normalized)) {
    return undefined;
  }
  return normalized.replace(/\s*\([^)]*\)\s*$/u, "").trim() || normalized;
}

function weatherWebcamDetailCacheKey(feature: SituationFeature): string | undefined {
  const metadata = weatherWebcamMetadata(feature);
  return metadata.detailUrl ? `${feature.properties.featureId}:${metadata.detailUrl}` : feature.properties.featureId;
}

function weatherWebcamLocationLabel(feature: SituationFeature, detail: WeatherWebcamDetail | null): string | undefined {
  const cameraBaseLabels = Array.from(new Set((detail?.cameras ?? [])
    .map((camera) => weatherCameraBaseLocationName(camera.label))
    .filter((value): value is string => Boolean(value))));
  if (cameraBaseLabels.length === 1) {
    return cameraBaseLabels[0];
  }
  const detailLocationLabel = normalizeWeatherWebcamDisplayLabel(detail?.location?.label ?? "");
  if (detailLocationLabel !== "Webkamera ČHMÚ") {
    return detailLocationLabel;
  }
  const featureLabel = weatherWebcamTitle(feature);
  return featureLabel !== "Webkamera ČHMÚ" ? featureLabel : undefined;
}

function weatherWebcamLocationCoordinates(feature: SituationFeature, detail: WeatherWebcamDetail | null): string {
  const lat = detail?.location?.lat;
  const lon = detail?.location?.lon;
  if (typeof lat === "number" && typeof lon === "number") {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  return formatSituationCoordinates(feature);
}

function applyWeatherWebcamDetailsToSituationFeatures(
  collection: SituationFeatureCollectionResponse | null,
  cache: Record<string, WeatherWebcamDetailCacheEntry>
): SituationFeatureCollectionResponse | null {
  if (!collection) {
    return collection;
  }
  let changed = false;
  const features = collection.features.map((feature) => {
    if (!isWeatherWebcamFeature(feature)) {
      return feature;
    }
    const key = weatherWebcamDetailCacheKey(feature);
    const entry = key ? cache[key] : undefined;
    const locationLabel = entry?.locationLabel;
    if (!locationLabel) {
      return feature;
    }
    const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
    const camera = weatherWebcamProviderMetadata(feature);
    changed = true;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        headline: locationLabel,
        label: locationLabel,
        providerProperties: {
          ...providerProperties,
          camera: {
            ...camera,
            label: locationLabel
          }
        }
      }
    };
  });
  return changed ? { ...collection, features } : collection;
}

function weatherWebcamSubtitle(feature: SituationFeature): string {
  return [
    "vizuální kontext počasí",
    feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId),
    feature.properties.stale ? "starší data" : undefined
  ].filter(Boolean).join(" · ");
}

function weatherCameraProxyUrl(value: string | undefined): string | undefined {
  const url = stringProperty(value);
  if (!url || isBlockedWeatherCameraHost(url)) {
    return undefined;
  }
  if (url.startsWith("/api/v1/weather/webcam-proxy")) {
    return `${apiBase}${url}`;
  }
  return `${apiBase}/api/v1/weather/webcam-proxy?url=${encodeURIComponent(url)}`;
}

function isBlockedWeatherCameraHost(value: string): boolean {
  if (value.startsWith("/")) {
    return false;
  }
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "chmi.cz" || hostname.endsWith(".chmi.cz");
  } catch {
    return true;
  }
}

function normalizeSituationCategory(category: string | undefined): string {
  return (category ?? "").toLowerCase().replace(/[\s.-]+/g, "_");
}

function isCurrentWeatherSummaryFeature(feature: SituationFeature): boolean {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return feature.properties.layerId === "public.weather.current"
    || feature.properties.providerLayerId === "weather.open_meteo"
    || (feature.properties.layer === "weather" && feature.properties.sourceId === "open_meteo")
    || stringProperty(tags.mapDisplayHint) === "weather_observation_point";
}

function isMeasuredWeatherStationFeature(feature: SituationFeature): boolean {
  const providerLayerId = stringProperty(feature.properties.providerLayerId);
  return feature.properties.layerId === "public.weather.observations"
    || feature.properties.sourceId === "chmi_weather_stations"
    || providerLayerId === "weather.chmi_station_observations"
    || providerLayerId?.includes("chmi_station") === true;
}

function weatherDisplayRecord(feature: SituationFeature): Record<string, unknown> | undefined {
  const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
  return isRecord(providerProperties.display) ? providerProperties.display : undefined;
}

function weatherDisplayString(feature: SituationFeature, key: string): string | undefined {
  const display = weatherDisplayRecord(feature);
  return display ? stringProperty(display[key]) : undefined;
}

function weatherDisplayNumber(feature: SituationFeature, key: string): number | undefined {
  const display = weatherDisplayRecord(feature);
  return display ? numberProperty(display[key]) : undefined;
}

function weatherDisplayTone(feature: SituationFeature): "neutral" | "ok" | "warn" | "critical" | undefined {
  const tone = weatherDisplayString(feature, "badgeTone")?.toLowerCase();
  switch (tone) {
    case "critical":
    case "danger":
    case "error":
      return "critical";
    case "warning":
    case "warn":
    case "advisory":
      return "warn";
    case "ok":
    case "success":
    case "info":
      return "ok";
    case "neutral":
    case "unknown":
      return "neutral";
    default:
      return undefined;
  }
}

function weatherConditionModeLabel(value: string | undefined): string | undefined {
  switch (value) {
    case "observed":
      return "autoritativní stav";
    case "measured":
      return "měřený jev";
    case "estimated":
      return "odhad SIM";
    case "unclassified":
      return "měření";
    default:
      return value;
  }
}

function weatherStationDetailUrl(feature: SituationFeature): string | undefined {
  return weatherDisplayString(feature, "detailUrl") ?? feature.properties.detailUrl;
}

function weatherFeatureHeadline(feature: SituationFeature): string {
  const displayTitle = weatherDisplayString(feature, "title");
  if (displayTitle) {
    return displayTitle;
  }
  if (isCurrentWeatherSummaryFeature(feature)) {
    return "Počasí ve středu oblasti";
  }
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  switch (feature.properties.layer) {
    case "weather_temperature_grid": {
      const value = weatherMetricValue(feature, metrics, "temperatureC");
      return value !== undefined ? `Teplota ${Math.round(value)} °C` : "Teplotní pole";
    }
    case "weather_wind_field": {
      const value = weatherMetricValue(feature, metrics, "windSpeedMps");
      return value !== undefined ? `Vítr ${Math.round(value)} m/s` : "Pole větru";
    }
    case "weather_precipitation_grid": {
      const value = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
      return value !== undefined ? `Srážky: ${precipitationIntensityLabel(value)}` : "Srážky";
    }
    case "weather_humidity_grid": {
      const value = weatherMetricValue(feature, metrics, "relativeHumidityPercent", "humidityPercent");
      return value !== undefined ? `Vlhkost ${Math.round(value)} %` : "Vlhkost vzduchu";
    }
    case "weather_pressure_grid": {
      const value = weatherMetricValue(feature, metrics, "pressureHpa", "pressureHpaSeaLevel");
      return value !== undefined ? `Tlak ${Math.round(value)} hPa` : "Tlak vzduchu";
    }
    case "weather_radar_reflectivity":
      return "Radarová odrazivost";
    case "weather_radar_precipitation":
      return "Radarové srážky";
    case "weather_radar_nowcast":
      return "Radarový nowcast";
    case "weather_thunderstorm_risk":
      return "Bouřkové riziko";
    default:
      return feature.properties.headline ?? feature.properties.label ?? "Počasí";
  }
}

function weatherFeatureSubtitle(feature: SituationFeature): string {
  const displaySubtitle = weatherDisplayString(feature, "subtitle");
  if (displaySubtitle) {
    return displaySubtitle;
  }
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  return [
    weatherFeatureValueLabel(feature, metrics),
    feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId),
    weatherDataQualityLabel(stringProperty(feature.properties.dataQuality)),
    feature.properties.stale ? "starší data" : undefined
  ].filter(Boolean).join(" · ");
}

function weatherFeatureTypeLabel(feature: SituationFeature): string {
  if (isCurrentWeatherSummaryFeature(feature)) {
    return "Aktuální souhrn oblasti";
  }
  switch (feature.properties.layer) {
    case "weather_temperature_grid":
      return "Teplotní vrstva";
    case "weather_wind_field":
      return "Vrstva větru";
    case "weather_precipitation_grid":
      return "Srážková vrstva";
    case "weather_humidity_grid":
      return "Vlhkostní vrstva";
    case "weather_pressure_grid":
      return "Tlaková vrstva";
    case "weather_radar_reflectivity":
      return "Radarová vrstva";
    case "weather_radar_precipitation":
      return "Radarová srážková vrstva";
    case "weather_radar_nowcast":
      return "Nowcasting srážek";
    case "weather_thunderstorm_risk":
      return "Bouřkové riziko";
    default:
      if (isMeasuredWeatherStationFeature(feature)) {
        return "Měřicí stanice ČHMÚ";
      }
      return "Měřené počasí";
  }
}

function weatherFeatureValueLabel(feature: SituationFeature, metrics: Record<string, unknown>): string | undefined {
  const displayValue = weatherDisplayString(feature, "primaryValue");
  if (displayValue) {
    return displayValue;
  }
  switch (feature.properties.layer) {
    case "weather_temperature_grid": {
      const value = weatherMetricValue(feature, metrics, "temperatureC");
      return value !== undefined ? `${Math.round(value)} °C` : undefined;
    }
    case "weather_wind_field": {
      const speed = weatherMetricValue(feature, metrics, "windSpeedMps");
      const direction = recordNumber(metrics, "windDirectionDeg");
      return [
        speed !== undefined ? `${Math.round(speed)} m/s` : undefined,
        direction !== undefined ? `${Math.round(direction)}°` : undefined
      ].filter(Boolean).join(", ") || undefined;
    }
    case "weather_precipitation_grid": {
      const value = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
      return value !== undefined ? `${formatPrecipitationAmount(value)} za 10 min` : undefined;
    }
    case "weather_humidity_grid": {
      const value = weatherMetricValue(feature, metrics, "relativeHumidityPercent", "humidityPercent");
      return value !== undefined ? `${Math.round(value)} %` : undefined;
    }
    case "weather_pressure_grid": {
      const value = weatherMetricValue(feature, metrics, "pressureHpa", "pressureHpaSeaLevel");
      return value !== undefined ? `${Math.round(value)} hPa` : undefined;
    }
    default:
      if (isMeasuredWeatherStationFeature(feature)) {
        return weatherMeasuredStationPrimaryValue(metrics);
      }
      return undefined;
  }
}

function weatherFeatureConditionLabel(feature: SituationFeature, metrics: Record<string, unknown>): string {
  const displayBadge = weatherDisplayString(feature, "badgeLabel");
  if (displayBadge) {
    return displayBadge;
  }
  const displayMode = weatherConditionModeLabel(weatherDisplayString(feature, "conditionMode"));
  if (displayMode) {
    return displayMode;
  }
  if (isCurrentWeatherSummaryFeature(feature)) {
    const temperature = weatherMetricValue(feature, metrics, "temperatureC");
    const wind = weatherMetricValue(feature, metrics, "windSpeedMps");
    const precipitation = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
    return [
      temperature !== undefined ? `${Math.round(temperature)} °C` : undefined,
      wind !== undefined ? `vítr ${Math.round(wind)} m/s` : undefined,
      precipitation !== undefined ? `${formatPrecipitationAmount(precipitation)} srážek` : undefined
    ].filter(Boolean).join(" · ") || "aktuální počasí";
  }
  switch (feature.properties.layer) {
    case "weather_precipitation_grid": {
      const value = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
      return value !== undefined ? precipitationIntensityLabel(value) : "srážky";
    }
    case "weather_wind_field": {
      const value = weatherMetricValue(feature, metrics, "windSpeedMps");
      if (value === undefined) {
        return "vítr";
      }
      if (value < 3) {
        return "slabý vítr";
      }
      if (value < 8) {
        return "mírný vítr";
      }
      if (value < 14) {
        return "čerstvý vítr";
      }
      return "silný vítr";
    }
    case "weather_temperature_grid":
      return "teplota";
    case "weather_humidity_grid":
      return "vlhkost";
    case "weather_pressure_grid":
      return "tlak";
    case "weather_radar_reflectivity":
      return "radarová odrazivost";
    case "weather_radar_precipitation":
      return "radarové srážky";
    case "weather_radar_nowcast":
      return "krátkodobá predikce srážek";
    case "weather_thunderstorm_risk":
      return "riziko bouřek";
    default:
      if (isMeasuredWeatherStationFeature(feature)) {
        return weatherMeasuredStationConditionLabel(metrics);
      }
      return "počasí";
  }
}

function weatherContextDetailRows(feature: SituationFeature): Array<[string, React.ReactNode]> {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const display = weatherDisplayRecord(feature);
  if (display && isMeasuredWeatherStationFeature(feature)) {
    const summaryRows = compactDetailRows([
      ["Stanice", weatherDisplayString(feature, "title") ?? feature.properties.label ?? feature.properties.headline],
      ["Závěr SIM", weatherFeatureConditionLabel(feature, metrics)],
      ["Hodnota", weatherDisplayString(feature, "primaryValue")],
      ["Doplňkově", [weatherDisplayString(feature, "secondaryValue"), weatherDisplayString(feature, "tertiaryValue")].filter(Boolean).join(" · ")],
      ["Typ závěru", weatherConditionModeLabel(weatherDisplayString(feature, "conditionMode"))],
      ["Jistota závěru", formatOptionalPercentFromWhole(weatherDisplayNumber(feature, "confidencePercent"), feature.properties.confidence)],
      ["Čas měření", formatShortDateTime(feature.properties.observedAt)],
      ["Stáří dat", formatAge(feature.properties.observedAt)],
      ["Zdroj", feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId)]
    ]);
    const measuredRows = weatherMeasuredStationDetailRows(feature, metrics, false);
    const rows = [...summaryRows, ...measuredRows];
    return rows.length > 0 ? rows : [["Stav", "měření"]];
  }
  if (!isMeasuredWeatherStationFeature(feature)) {
    return [
      ["Charakter", weatherFeatureConditionLabel(feature, metrics)],
      ["Kvalita dat", weatherDataQualityLabel(stringProperty(feature.properties.dataQuality)) ?? "n/a"],
      ["Jistota", formatOptionalPercent(feature.properties.confidence)]
    ];
  }
  return weatherMeasuredStationDetailRows(feature, metrics, true);
}

function weatherMeasuredStationDetailRows(
  feature: SituationFeature,
  metrics: Record<string, unknown>,
  includeIdentity: boolean
): Array<[string, React.ReactNode]> {
  const temperatureC = weatherMeasuredMetric(metrics, "temperatureC");
  const temperatureMinC = weatherMeasuredMetric(metrics, "temperatureMinC", "minTemperatureC", "temperatureMinimumC", "temperatureMin24hC");
  const temperatureMaxC = weatherMeasuredMetric(metrics, "temperatureMaxC", "maxTemperatureC", "temperatureMaximumC", "temperatureMax24hC");
  const windSpeedMps = weatherMeasuredMetric(metrics, "windSpeedMps");
  const windGustMps = weatherMeasuredMetric(metrics, "windGustMps");
  const windDirectionDeg = weatherMeasuredMetric(metrics, "windDirectionDeg");
  const precipitation10mMm = weatherMeasuredMetric(metrics, "precipitation10mMm", "precipitationMm");
  const humidityPercent = weatherMeasuredMetric(metrics, "relativeHumidityPercent", "humidityPercent");
  const pressureHpa = weatherMeasuredMetric(metrics, "pressureHpa", "pressureHpaSeaLevel");
  const sunshineDurationSeconds = weatherMeasuredMetric(metrics, "sunshineDurationSeconds");
  const elevationM = weatherMeasuredMetric(metrics, "elevationM");
  const ageSeconds = weatherMeasuredMetric(metrics, "ageSeconds");
  return compactDetailRows([
    ["Stanice", includeIdentity ? feature.properties.label ?? feature.properties.headline : undefined],
    ["Čas měření", includeIdentity ? formatShortDateTime(feature.properties.observedAt) : undefined],
    ["Stáří dat", includeIdentity ? ageSeconds !== undefined ? formatDurationSeconds(ageSeconds) : formatAge(feature.properties.observedAt) : undefined],
    ["Teplota", temperatureC !== undefined ? formatOptionalNumber(temperatureC, " °C") : undefined],
    ["Teplota min/max", formatWeatherTemperatureRange(temperatureMinC, temperatureMaxC)],
    ["Vítr", formatMeasuredWeatherWind(windDirectionDeg, windSpeedMps, windGustMps)],
    ["Srážky 10 min", precipitation10mMm !== undefined ? formatPrecipitationAmount(precipitation10mMm) : undefined],
    ["Vlhkost", humidityPercent !== undefined ? `${Math.round(humidityPercent)} %` : undefined],
    ["Tlak", pressureHpa !== undefined ? `${Math.round(pressureHpa)} hPa` : undefined],
    ["Sluneční svit", sunshineDurationSeconds !== undefined ? formatDurationSeconds(sunshineDurationSeconds) : undefined],
    ["Nadmořská výška", elevationM !== undefined ? formatOptionalNumber(elevationM, " m") : undefined],
    ["Kvalita dat", weatherDataQualityLabel(stringProperty(feature.properties.dataQuality))],
    ["Jistota", formatOptionalPercent(feature.properties.confidence)],
    ["Zdroj", includeIdentity ? feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId) : undefined]
  ]);
}

function compactDetailRows(rows: Array<[string, React.ReactNode | undefined]>): Array<[string, React.ReactNode]> {
  return rows
    .filter(([, value]) => value !== undefined && value !== "" && value !== "n/a")
    .map(([label, value]) => [label, value as React.ReactNode] as [string, React.ReactNode]);
}

function weatherMeasuredMetric(metrics: Record<string, unknown>, ...keys: string[]): number | undefined {
  return firstRecordNumber(metrics, ...keys);
}

function weatherMeasuredStationPrimaryValue(metrics: Record<string, unknown>): string | undefined {
  const temperatureC = weatherMeasuredMetric(metrics, "temperatureC");
  const windSpeedMps = weatherMeasuredMetric(metrics, "windSpeedMps");
  const precipitation10mMm = weatherMeasuredMetric(metrics, "precipitation10mMm", "precipitationMm");
  const parts = [
    temperatureC !== undefined ? `${Math.round(temperatureC)} °C` : undefined,
    windSpeedMps !== undefined ? `vítr ${Math.round(windSpeedMps)} m/s` : undefined,
    precipitation10mMm !== undefined && precipitation10mMm > 0 ? `${formatPrecipitationAmount(precipitation10mMm)} srážek` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function weatherMeasuredStationConditionLabel(metrics: Record<string, unknown>): string {
  const temperatureC = weatherMeasuredMetric(metrics, "temperatureC");
  const windSpeedMps = weatherMeasuredMetric(metrics, "windSpeedMps");
  const precipitation10mMm = weatherMeasuredMetric(metrics, "precipitation10mMm", "precipitationMm");
  const humidityPercent = weatherMeasuredMetric(metrics, "relativeHumidityPercent", "humidityPercent");
  if (precipitation10mMm !== undefined && precipitation10mMm > 0) {
    return temperatureC !== undefined && temperatureC <= 1.5 ? "měřený sníh/srážky" : "měřené srážky";
  }
  if (humidityPercent !== undefined && humidityPercent >= 95 && (windSpeedMps === undefined || windSpeedMps < 3)) {
    return "podmínky pro mlhu";
  }
  if (windSpeedMps !== undefined && windSpeedMps >= 7) {
    return "větrno";
  }
  return "měřicí stanice";
}

function formatWeatherTemperatureRange(minC: number | undefined, maxC: number | undefined): string | undefined {
  if (minC === undefined && maxC === undefined) {
    return undefined;
  }
  if (minC !== undefined && maxC !== undefined) {
    return `${Math.round(minC)} / ${Math.round(maxC)} °C`;
  }
  return minC !== undefined ? `min ${Math.round(minC)} °C` : `max ${Math.round(maxC as number)} °C`;
}

function formatMeasuredWeatherWind(directionDeg: number | undefined, speedMps: number | undefined, gustMps: number | undefined): string {
  const parts = [
    directionDeg !== undefined ? `${Math.round(directionDeg)}°` : undefined,
    speedMps !== undefined ? `${Math.round(speedMps)} m/s` : undefined,
    gustMps !== undefined ? `náraz ${Math.round(gustMps)} m/s` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "n/a";
}

function weatherTemperatureTone(value: number | undefined): "neutral" | "ok" | "warn" | "critical" {
  if (value === undefined) {
    return "neutral";
  }
  if (value >= 34 || value <= -12) {
    return "critical";
  }
  if (value >= 30 || value <= -6) {
    return "warn";
  }
  return "ok";
}

function weatherMeasuredWindTone(speedMps: number | undefined, gustMps: number | undefined): "neutral" | "ok" | "warn" | "critical" {
  const value = Math.max(speedMps ?? 0, gustMps ?? 0);
  if (value <= 0) {
    return "neutral";
  }
  if (value >= 20) {
    return "critical";
  }
  if (value >= 12) {
    return "warn";
  }
  return "ok";
}

function weatherMeasuredPrecipitationTone(value: number | undefined): "neutral" | "ok" | "warn" | "critical" {
  if (value === undefined || value <= 0.02) {
    return "neutral";
  }
  if (value >= 5) {
    return "critical";
  }
  if (value >= 2) {
    return "warn";
  }
  return "ok";
}

function weatherMetricValue(feature: SituationFeature, metrics: Record<string, unknown>, ...fallbackKeys: string[]): number | undefined {
  const rendering = isRecord(feature.properties.rendering) ? feature.properties.rendering : {};
  const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
  const providerRendering = isRecord(providerProperties.rendering) ? providerProperties.rendering : {};
  const metricKey = stringProperty(rendering.valueMetric) ?? stringProperty(providerRendering.valueMetric);
  if (metricKey) {
    const metricValue = recordNumber(metrics, metricKey);
    if (metricValue !== undefined) {
      return metricValue;
    }
  }
  return recordNumber(metrics, "value") ?? firstRecordNumber(metrics, ...fallbackKeys);
}

function weatherFeatureTone(feature: SituationFeature): "neutral" | "ok" | "warn" | "critical" {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  if (feature.properties.stale) {
    return "warn";
  }
  const displayTone = weatherDisplayTone(feature);
  if (displayTone) {
    return displayTone;
  }
  if (feature.properties.layer === "weather_precipitation_grid") {
    const value = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
    if (value === undefined || value <= 0.02) {
      return "neutral";
    }
    if (value >= 5) {
      return "critical";
    }
    return value >= 2 ? "warn" : "ok";
  }
  if (feature.properties.layer === "weather_wind_field") {
    const value = weatherMetricValue(feature, metrics, "windSpeedMps");
    if (value === undefined) {
      return "neutral";
    }
    if (value >= 22) {
      return "critical";
    }
    return value >= 14 ? "warn" : "ok";
  }
  return "neutral";
}

function formatPrecipitationAmount(value: number): string {
  return value < 0.05 ? "0 mm" : `${value.toFixed(value < 1 ? 1 : 0)} mm`;
}

function precipitationIntensityLabel(value: number): string {
  if (value <= 0.02) {
    return "beze srážek";
  }
  if (value < 0.2) {
    return "mrholení";
  }
  if (value < 0.8) {
    return "slabé";
  }
  if (value < 2) {
    return "mírné";
  }
  if (value < 5) {
    return "výrazné";
  }
  return "silné";
}

function weatherDataQualityLabel(value: string | undefined): string | undefined {
  switch (value) {
    case "observed":
      return "měřeno";
    case "mixed":
      return "měřeno + model";
    case "modelled":
      return "model";
    default:
      return undefined;
  }
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

function objectStatusLabel(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === "ACTIVE") {
    return "aktivní";
  }
  if (normalized === "INACTIVE") {
    return "neaktivní";
  }
  if (normalized === "LOST") {
    return "ztracený";
  }
  if (normalized === "STALE") {
    return "starší data";
  }
  if (normalized === "CONFLICTED") {
    return "konflikt dat";
  }
  return status.toLowerCase();
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

function formatSignedMetric(value: number | undefined, unit: string): string {
  if (value === undefined) {
    return "n/a";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}${unit}`;
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

function firstRecordNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = recordNumber(record, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function safetyMetricNumber(
  properties: SituationFeature["properties"],
  metrics: Record<string, unknown>,
  propertyKey: string,
  metricKey: string = String(propertyKey)
): number | undefined {
  const propertyValue = numberProperty((properties as unknown as Record<string, unknown>)[propertyKey]);
  return propertyValue ?? recordNumber(metrics, metricKey);
}

function safetyGeometryModeLabel(mode: string | undefined, geometryType: string): string {
  switch (mode) {
    case "admin_boundary":
      return "územní polygon";
    case "representative_point":
      return "náhradní bod";
    case undefined:
      return geometryType;
    default:
      return mode.replace(/_/g, " ");
  }
}

function safetyCanonicalTypeCode(properties: SituationFeature["properties"]): string | undefined {
  const providerProperties = safetyProviderProperties(properties);
  const taxonomy = safetyProviderTaxonomy(properties);
  return properties.typeCode
    ?? stringProperty(providerProperties.typeCode)
    ?? stringProperty(taxonomy.typeCode);
}

function safetyCanonicalSourceCode(properties: SituationFeature["properties"]): string | undefined {
  const providerProperties = safetyProviderProperties(properties);
  const taxonomy = safetyProviderTaxonomy(properties);
  const sourceCode = properties.sourceCode
    ?? stringProperty(providerProperties.sourceCode)
    ?? stringProperty(taxonomy.sourceCode);
  if (!sourceCode) {
    return undefined;
  }
  const sourceSystem = properties.sourceSystem
    ?? stringProperty(providerProperties.sourceSystem)
    ?? stringProperty(taxonomy.codeSystem)
    ?? stringProperty(taxonomy.sourceSystem);
  return sourceSystem ? `${sourceSystem} ${sourceCode}` : sourceCode;
}

function safetyCanonicalSourceSystem(properties: SituationFeature["properties"]): string | undefined {
  const providerProperties = safetyProviderProperties(properties);
  const taxonomy = safetyProviderTaxonomy(properties);
  return properties.sourceSystem
    ?? stringProperty(providerProperties.sourceSystem)
    ?? stringProperty(taxonomy.codeSystem)
    ?? stringProperty(taxonomy.sourceSystem);
}

function safetyProviderProperties(properties: SituationFeature["properties"]): Record<string, unknown> {
  return isRecord(properties.providerProperties) ? properties.providerProperties : {};
}

function safetyProviderTaxonomy(properties: SituationFeature["properties"]): Record<string, unknown> {
  const providerProperties = safetyProviderProperties(properties);
  return isRecord(providerProperties.taxonomy) ? providerProperties.taxonomy : {};
}

function safetyProviderPresentation(properties: SituationFeature["properties"]): Record<string, unknown> {
  const providerProperties = safetyProviderProperties(properties);
  return isRecord(providerProperties.presentation) ? providerProperties.presentation : {};
}

function safetyProviderNotification(properties: SituationFeature["properties"]): Record<string, unknown> {
  const providerProperties = safetyProviderProperties(properties);
  return isRecord(providerProperties.notification) ? providerProperties.notification : {};
}

function localizedSafetyRecord(properties: SituationFeature["properties"], locale = "cs"): Record<string, unknown> {
  const localized = isRecord(properties.localized) ? properties.localized : {};
  const entry = localized[locale];
  return isRecord(entry) ? entry : localized;
}

function localizedSafetyString(properties: SituationFeature["properties"], locale: "cs" | "en", ...keys: string[]): string | undefined {
  const record = localizedSafetyRecord(properties, locale);
  for (const key of keys) {
    const value = stringProperty(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function safetyPresentationString(properties: SituationFeature["properties"], ...keys: string[]): string | undefined {
  const presentation = safetyProviderPresentation(properties);
  for (const key of keys) {
    const value = stringProperty(presentation[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function safetyDisplayLabel(properties: SituationFeature["properties"]): string {
  return localizedSafetyString(properties, "cs", "headline", "title", "label", "name")
    ?? safetyPresentationString(properties, "label", "title")
    ?? properties.headline
    ?? properties.areaName
    ?? properties.label
    ?? humanizeSafetyTypeCode(safetyCanonicalTypeCode(properties))
    ?? safetyCanonicalSourceCode(properties)
    ?? "Výstraha";
}

function safetyDetailText(properties: SituationFeature["properties"]): string | undefined {
  return localizedSafetyString(properties, "cs", "detail", "description", "summary")
    ?? renderSafetyDetailTemplate(properties)
    ?? properties.description
    ?? properties.summary;
}

function renderSafetyDetailTemplate(properties: SituationFeature["properties"]): string | undefined {
  const template = safetyPresentationString(properties, "detailTemplate");
  if (!template) {
    return undefined;
  }
  const values: Record<string, string> = {
    areaName: properties.areaName ?? properties.affectedArea ?? "",
    headline: properties.headline ?? properties.label ?? "",
    label: safetyDisplayLabel(properties),
    severity: properties.severity ?? properties.status ?? "",
    sourceCode: safetyCanonicalSourceCode(properties) ?? "",
    sourceSystem: safetyCanonicalSourceSystem(properties) ?? "",
    typeCode: safetyCanonicalTypeCode(properties) ?? ""
  };
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) => values[key] ?? "").replace(/\s+/g, " ").trim() || undefined;
}

function safetyNotificationEligibleLabel(properties: SituationFeature["properties"]): string {
  const notification = safetyProviderNotification(properties);
  const value = notification.eligible;
  if (value === false) {
    return "ne";
  }
  if (value === true) {
    return "ano";
  }
  return "neuvedeno";
}

function humanizeSafetyTypeCode(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const known: Record<string, string> = {
    "air_quality.pm10.smog": "Smogová situace PM10",
    "hydro.flood.warning": "Hydrologická výstraha",
    "weather.fire_danger": "Nebezpečí požáru",
    "weather.temperature.high": "Vysoké teploty"
  };
  return known[value] ?? value.split(/[._-]+/u).filter(Boolean).join(" ");
}

function safetyHazardLabel(value: string | undefined): string {
  const normalized = (value ?? "").toLowerCase().replace(/[_-]/g, " ");
  if (normalized.includes("air quality") || normalized.includes("pm10") || normalized.includes("no2") || normalized.includes("so2") || normalized.includes("o3")) {
    return "Kvalita ovzduší";
  }
  if (normalized.includes("slippery") || normalized.includes("ice") || normalized.includes("naled") || normalized.includes("ledov")) {
    return "Náledí / ledovka";
  }
  if (normalized.includes("snow")) {
    return "Sníh a sněhové jevy";
  }
  if (normalized.includes("temperature high") || normalized.includes("heat")) {
    return "Vysoké teploty";
  }
  if (normalized.includes("temperature low") || normalized.includes("cold")) {
    return "Nízké teploty";
  }
  if (normalized.includes("drought")) {
    return "Sucho";
  }
  if (normalized.includes("fire")) {
    return "Nebezpečí požáru";
  }
  if (normalized.includes("flood") || normalized.includes("hydro")) {
    return "Povodňové riziko";
  }
  if (normalized.includes("wind")) {
    return "Vítr";
  }
  if (normalized.includes("storm")) {
    return "Bouřky";
  }
  if (normalized.includes("weather")) {
    return "Meteorologická výstraha";
  }
  return value ? value.replace(/[_-]/g, " ") : "Riziko";
}

function safetyBasisLabel(value: string[] | undefined): string {
  if (!value || value.length === 0) {
    return "n/a";
  }
  const labels = value
    .filter((item) => !item.startsWith("http://") && !item.startsWith("https://"))
    .map((item) => {
      switch (item) {
        case "chmi_cap":
          return "ČHMÚ CAP";
        case "chmi_cap_cisorp":
          return "ČSÚ CISORP";
        case "osm_postgis_admin_boundary_match":
          return "PostGIS hranice ORP";
        case "chmi_hydro_now":
          return "ČHMÚ hydrologie";
        default:
          return item.replace(/_/g, " ");
      }
    });
  return labels.length > 0 ? Array.from(new Set(labels)).slice(0, 4).join(" · ") : "n/a";
}

function floodStageLabel(value: number | undefined): string {
  if (value === undefined || value <= 0) {
    return "bez SPA";
  }
  if (value === 1) {
    return "1. SPA bdělost";
  }
  if (value === 2) {
    return "2. SPA pohotovost";
  }
  if (value === 3) {
    return "3. SPA ohrožení";
  }
  return `${Math.round(value)}. SPA`;
}

function floodStageStatusModel(value: number): { label: string; tone: "neutral" | "ok" | "warn" | "critical" } {
  if (value <= 0) {
    return { label: "bez SPA", tone: "ok" };
  }
  if (value === 1) {
    return { label: "1. SPA", tone: "warn" };
  }
  if (value === 2) {
    return { label: "2. SPA", tone: "warn" };
  }
  return { label: value >= 4 ? "extrémní SPA" : "3. SPA", tone: "critical" };
}

function formatHydroForecast(properties: SituationFeature["properties"], metrics: Record<string, unknown>): string {
  const available = booleanProperty(properties.forecastAvailable) ?? booleanProperty(metrics.forecastAvailable);
  const until = properties.forecastUntil ?? stringProperty(metrics.forecastUntil);
  if (available === false) {
    return "není dostupná";
  }
  if (available === true) {
    return until ? `dostupná do ${formatShortDateTime(until)}` : "dostupná";
  }
  return until ? `do ${formatShortDateTime(until)}` : "n/a";
}

function floodTrendLabel(value: string | undefined): string {
  switch (value) {
    case "rising":
      return "stoupá";
    case "falling":
      return "klesá";
    case "stable":
      return "stabilní";
    case "unknown":
    case undefined:
      return "neznámý";
    default:
      return value;
  }
}

function floodTrendTone(value: string | undefined): "neutral" | "ok" | "warn" | "critical" {
  switch (value) {
    case "rising":
      return "warn";
    case "falling":
      return "ok";
    default:
      return "neutral";
  }
}

function fireStatusLabel(value: string | undefined): string {
  switch (value) {
    case "active":
      return "aktivní požár";
    case "confirmed":
      return "potvrzeno";
    case "contained":
      return "pod kontrolou";
    case "risk":
      return "požární nebezpečí";
    case "thermal_anomaly":
      return "tepelná anomálie";
    case "unknown":
    case undefined:
      return "neznámý";
    default:
      return value.replace(/_/g, " ");
  }
}

function fireSourceIncidentLabel(value: string | undefined): string {
  switch (value) {
    case "CHMI_CAP_FIRE_DANGER":
      return "ČHMÚ požární nebezpečí";
    case "NASA_FIRMS_HOTSPOT":
      return "NASA FIRMS hotspot";
    default:
      return value ? value.replace(/_/g, " ") : "n/a";
  }
}

function fireConfirmationLabel(typeCode: string | undefined, sourceIncident: string | undefined): string {
  if (typeCode === "weather.fire_danger" || sourceIncident === "CHMI_CAP_FIRE_DANGER") {
    return "nejde o potvrzený požár";
  }
  if (sourceIncident === "NASA_FIRMS_HOTSPOT") {
    return "satelitní detekce, vyžaduje ověření";
  }
  return "situační kontext";
}

function fireRiskNotice(properties: SituationFeature["properties"]): string {
  if (safetyCanonicalTypeCode(properties) === "weather.fire_danger" || properties.sourceIncident === "CHMI_CAP_FIRE_DANGER") {
    return "Oficiální výstraha ČHMÚ pro podmínky vzniku a šíření požárů.";
  }
  if (properties.sourceIncident === "NASA_FIRMS_HOTSPOT") {
    return "Tepelná anomálie ze satelitu, nikoli potvrzený incident HZS.";
  }
  return properties.description ?? "n/a";
}

function humanizeApiError(value: string): string {
  if (value.includes("401")) {
    return "Přihlášení už není platné. Přihlaste se znovu v horní liště.";
  }
  if (value.includes("403")) {
    return "K této části nemáte oprávnění.";
  }
  if (value.includes("failed") || value.includes("Load failed")) {
    return "Služba je dočasně nedostupná. Zkuste obnovit stav.";
  }
  return value;
}

function incidentCategoryLabel(value: IncidentRecord["category"]): string {
  switch (value) {
    case "community":
      return "hlášení";
    case "fire":
      return "požár";
    case "flood":
      return "povodeň";
    case "infrastructure":
      return "infrastruktura";
    case "medical":
      return "zdravotní";
    case "security":
      return "bezpečnost";
    case "traffic":
      return "doprava";
    case "weather":
      return "počasí";
    case "other":
    default:
      return "ostatní";
  }
}

function incidentSeverityLabel(value: IncidentSeverity): string {
  switch (value) {
    case "critical":
      return "kritické";
    case "warning":
      return "varování";
    case "advisory":
      return "upozornění";
    case "info":
    default:
      return "info";
  }
}

function incidentStatusLabel(value: IncidentStatus): string {
  switch (value) {
    case "active":
      return "Aktivní";
    case "candidate":
      return "K ověření";
    case "monitoring":
      return "Sledování";
    case "resolved":
      return "Vyřešeno";
    case "rejected":
      return "Odmítnuto";
    case "closed":
    default:
      return "Uzavřeno";
  }
}

function incidentTaskPriorityLabel(value: IncidentTaskRecord["priority"]): string {
  switch (value) {
    case "urgent":
      return "urgentní";
    case "high":
      return "vysoká priorita";
    case "low":
      return "nižší priorita";
    case "normal":
    default:
      return "standardní priorita";
  }
}

function incidentTaskStatusLabel(value: IncidentTaskStatus): string {
  switch (value) {
    case "blocked":
      return "blokováno";
    case "cancelled":
      return "zrušeno";
    case "done":
      return "hotovo";
    case "in_progress":
      return "řeší se";
    case "open":
    default:
      return "otevřeno";
  }
}

function formatIncidentConfidence(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)} % jistota`;
}

function formatIncidentDistance(value: number): string {
  if (!Number.isFinite(value)) {
    return "rozptyl n/a";
  }
  if (value >= 1000) {
    return `rozptyl ${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km`;
  }
  return `rozptyl ${Math.round(value)} m`;
}

function formatIncidentTimeSpan(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "časové okno n/a";
  }
  if (value < 3600) {
    return `okno ${Math.round(value / 60)} min`;
  }
  return `okno ${(value / 3600).toFixed(value >= 36000 ? 0 : 1)} h`;
}

function formatDurationSeconds(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  if (value < 60) {
    return `${Math.round(value)} s`;
  }
  if (value < 3600) {
    return `${Math.round(value / 60)} min`;
  }
  return `${Math.round((value / 3600) * 10) / 10} h`;
}

function formatFloodThresholds(metrics: Record<string, unknown>): string {
  const thresholdRows: Array<[string, number | undefined, number | undefined]> = [
    ["1. SPA", recordNumber(metrics, "spa1Cm"), recordNumber(metrics, "spa1FlowM3s")],
    ["2. SPA", recordNumber(metrics, "spa2Cm"), recordNumber(metrics, "spa2FlowM3s")],
    ["3. SPA", recordNumber(metrics, "spa3Cm"), recordNumber(metrics, "spa3FlowM3s")]
  ];
  const thresholds = thresholdRows
    .map(([label, level, flow]) => {
      const parts = [
        typeof level === "number" ? `${level} cm` : undefined,
        typeof flow === "number" ? `${Math.round(flow * 10) / 10} m3/s` : undefined
      ].filter(Boolean);
      return parts.length > 0 ? `${label}: ${parts.join(" / ")}` : undefined;
    })
    .filter(Boolean);
  return thresholds.length > 0 ? thresholds.join(" · ") : "n/a";
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

function booleanProperty(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "ano"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "ne"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
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

function sourceDisplayName(sourceSystemId: string | undefined): string {
  if (!sourceSystemId) {
    return "zdroj není dostupný";
  }
  const labels: Record<string, string> = {
    aviation_weather: "METAR/TAF",
    chmi_air_quality: "ČHMÚ",
    chmi_weather_stations: "ČHMÚ",
    chmi_weather_webcams: "ČHMÚ webkamery",
    "flight-data-api": "Veřejná letecká data",
    "mission-arena": "Mission Arena",
    open_meteo: "Open-Meteo",
    "safety-data-api": "Výstražná data",
    "sim-air-situation-001": "Cvičná letecká situace",
    "situation-data-api": "Situační vrstvy",
    "tak-gateway": "Partnerská data"
  };
  return labels[sourceSystemId] ?? sourceSystemId;
}

function objectTypeDisplayName(objectType: string): string {
  const normalized = objectType.trim().toUpperCase();
  const labels: Record<string, string> = {
    AIRCRAFT: "Letadlo",
    INFRASTRUCTURE: "Infrastruktura",
    MISSILE: "Vzdušný objekt",
    PERSON: "Osoba",
    SENSOR: "Senzor",
    UAV: "Dron",
    UNIT: "Jednotka",
    VEHICLE: "Vozidlo",
    VESSEL: "Plavidlo"
  };
  return labels[normalized] ?? objectType;
}

function domainDisplayName(domain: string): string {
  const normalized = domain.trim().toUpperCase();
  const labels: Record<string, string> = {
    AIR: "vzduch",
    LAND: "země",
    MARITIME: "voda",
    OTHER: "ostatní",
    RESCUE: "záchrana",
    SPACE: "vesmír",
    SUBSURFACE: "pod hladinou",
    SURFACE: "povrch"
  };
  return labels[normalized] ?? domain.toLowerCase();
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

function predictionModeLabel(mode: PredictionMode): string {
  return predictionModeOptions.find(([value]) => value === mode)?.[1] ?? "Adaptivní";
}

function operatorDisplayName(session: AuthSession, config: AuthConfig, profile: OperatorProfilePreferences): string {
  if (session.status === "authenticated") {
    return profile.displayName ?? session.profile?.name ?? "Přihlášen";
  }
  if (session.status === "authenticating") {
    return "Ověřuji";
  }
  if (session.status === "error") {
    return "Chyba přihlášení";
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

function shouldPreferLocalAlertPreferences(localUpdatedAt: string | null, serverUpdatedAt: string | null): boolean {
  if (!localUpdatedAt) {
    return false;
  }
  const localTime = Date.parse(localUpdatedAt);
  if (!Number.isFinite(localTime)) {
    return false;
  }
  if (!serverUpdatedAt) {
    return true;
  }
  const serverTime = Date.parse(serverUpdatedAt);
  return !Number.isFinite(serverTime) || localTime > serverTime;
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
      return { description: "Seznam objektů, filtrování a datové vrstvy.", label: "Data" };
    case "sources":
      return { description: "Stav zdrojů, odezva a kvalita přijatých dat.", label: "Zdroje" };
    case "alerts":
      return { description: "Výstrahy, oblast polohy operátora a aktivní přiblížení.", label: "Výstrahy" };
    case "radio":
      return { description: "Model DEM/LoS pro rádiové spojení, pokrytí a volbu stanoviště.", label: "Radio LoS" };
    case "replay":
      return { description: "Historie stop, zpětné přehrání a predikce.", label: "Replay" };
    case "map":
    default:
      return { description: "Primární situační mapa se symboly APP-6.", label: "Mapa" };
  }
}

function workspaceLabel(module: WorkspaceModule): string {
  return workspaceMetadata(module).label;
}

function workspaceRailLabel(module: WorkspaceModule): string {
  switch (module) {
    case "data":
      return "Přehled";
    case "alerts":
      return "Události";
    case "radio":
      return "Radio";
    case "replay":
      return "Analýzy";
    default:
      return workspaceLabel(module);
  }
}

function workspaceIcon(module: WorkspaceModule): React.ReactNode {
  switch (module) {
    case "data":
      return <ListFilter size={16} />;
    case "sources":
      return <RadioTower size={16} />;
    case "alerts":
      return <AlertTriangle size={16} />;
    case "radio":
      return <RadioTower size={16} />;
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
  if (layer.layerId === "public.weather.current") {
    return "Referenční bod pro střed mapy";
  }
  if (layer.layerId === "public.weather.observations") {
    return "Měřené počasí ČHMÚ ve stanicích";
  }
  if (layer.layerId === "public.weather.webcams") {
    return "Bodové náhledy kamer ČHMÚ";
  }
  if (layer.layerId === "public.weather.radar_precipitation") {
    return "Radarová mapa s automatickou obnovou";
  }
  if (layer.layerId === "public.safety.air_quality") {
    return "Měřicí stanice kvality ovzduší";
  }
  if (layer.layerId === "public.weather.temperature_grid") {
    return "Plošná teplotní vrstva";
  }
  if (layer.layerId === "public.weather.wind_field") {
    return "Plošná vrstva směru a rychlosti větru";
  }
  if (layer.layerId === "public.weather.precipitation_grid") {
    return "Plošná vrstva srážek";
  }
  if (layer.layerId === "public.weather.humidity_grid") {
    return "Plošná vrstva vlhkosti";
  }
  if (layer.layerId === "public.weather.pressure_grid") {
    return "Plošná vrstva tlaku";
  }
  if (layer.kind === "raster_overlay") {
    return "Rastrová mapa nad podkladem";
  }
  if (layer.kind === "grid_field" || layer.kind === "vector_field") {
    return "Plošný model ze zdrojových měření";
  }
  const geometry = layer.geometryTypes && layer.geometryTypes.length > 0 ? layer.geometryTypes.join("/") : "data";
  const cadence = typeof layer.refreshSeconds === "number" ? `${layer.refreshSeconds}s` : "dle zdroje";
  return `${geometry} · ${cadence}`;
}

function catalogLayerProviderLabel(layer: MapCatalogLayer): string {
  if (layer.query.providerId === "sim.situation-data") {
    if (layer.groupId === "risks.weather" || layer.layerId.startsWith("public.weather.") || layer.layerId === "public.safety.air_quality") {
      if ((layer.query.providerSourceIds ?? []).includes("chmi_weather_radar")) {
        return "ČHMÚ radar";
      }
      if ((layer.query.providerSourceIds ?? []).includes("chmi_weather_stations")) {
        return "ČHMÚ stanice";
      }
      if ((layer.query.providerSourceIds ?? []).includes("chmi_weather_webcams")) {
        return "ČHMÚ webkamery";
      }
      if ((layer.query.providerSourceIds ?? []).includes("chmi_air_quality")) {
        return "ČHMÚ ovzduší";
      }
      return "Počasí";
    }
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

function buildMapLayerLabel(trackLayerIds: CopLayer[], situationLayerIds: SituationLayerId[], safetyLayerIds: SafetyLayerId[], takLayerIds: TakLayerId[], flightLayerCount = 0, communityLayerCount = 0, missionArenaLayerCount = 0, outlineBoundaryLayerEnabled = false, sketchLayerCount = 0): string {
  const parts: string[] = [];
  if (trackLayerIds.length > 0) {
    parts.push(`${trackLayerIds.length} letecká`);
  }
  if (flightLayerCount > 0) {
    parts.push(`${flightLayerCount} veřejné lety`);
  }
  if (communityLayerCount > 0) {
    parts.push(`${communityLayerCount} hlášení`);
  }
  if (missionArenaLayerCount > 0) {
    parts.push(`${missionArenaLayerCount} mise`);
  }
  if (situationLayerIds.length > 0) {
    parts.push(`${situationLayerIds.length} kontext`);
  }
  if (safetyLayerIds.length > 0) {
    parts.push(`${safetyLayerIds.length} rizika`);
  }
  if (outlineBoundaryLayerEnabled) {
    parts.push("hranice");
  }
  if (sketchLayerCount > 0) {
    parts.push(`${sketchLayerCount} zákresy`);
  }
  if (takLayerIds.length > 0) {
    parts.push(`${takLayerIds.length} TAK`);
  }
  return parts.length > 0 ? parts.join(" + ") : "žádná vrstva";
}

function buildCatalogLayerSummary(
  catalog: MapCatalogResponse | null,
  selectedLayerIds: string[],
  getFeatureCount: (layer: MapCatalogLayer) => number,
  getStatus: (layer: MapCatalogLayer) => SituationLayerStatus
): string {
  if (!catalog || selectedLayerIds.length === 0) {
    return "Zapněte vrstvu v katalogu vlevo";
  }
  const selected = new Set(selectedLayerIds);
  const layers = selectableCatalogLayers(catalog)
    .filter((layer) => selected.has(layer.layerId) && isImplementedCatalogLayer(layer));
  if (layers.length === 0) {
    return "Žádná zobrazitelná vrstva není zapnutá";
  }
  const totalFeatures = layers.reduce((sum, layer) => sum + getFeatureCount(layer), 0);
  const loading = layers.some((layer) => getStatus(layer) === "loading");
  const degraded = layers.some((layer) => getStatus(layer) === "degraded");
  const disabled = layers.some((layer) => getStatus(layer) === "disabled");
  const highlightedLayers = layers
    .map((layer) => ({ count: getFeatureCount(layer), label: layer.label }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "cs"))
    .slice(0, 3)
    .map((layer) => `${layer.label}: ${layer.count}`);
  const status = loading
    ? "načítám"
    : degraded
      ? "omezeno"
      : disabled
        ? "některé zdroje nedostupné"
        : totalFeatures === 0
          ? "bez prvků v záběru"
          : "živě";
  return `${layers.length} vrstev · ${totalFeatures} prvků · ${status}${highlightedLayers.length > 0 ? ` · ${highlightedLayers.join(" · ")}` : ""}`;
}

function readInitialAffiliationScope(value: string | undefined): AffiliationScope {
  return ["all", "friend", "hostile", "neutral", "unknown"].includes(value ?? "")
    ? (value as AffiliationScope)
    : "all";
}

type CatalogProviderId = "cop.community" | "cop.sketch" | "csm.mission-arena" | "sim.flight-data" | "sim.safety-data" | "sim.situation-data" | "sim.tak-gateway";

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
    && isImplementedCatalogLayer(layer)
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
  const supportedProviderQuery = layer.query.mode === "bbox"
    || (layer.query.mode === "grid" && layer.query.providerId === "sim.situation-data");
  return (supportedProviderQuery
    && (layer.query.providerId === "cop.community"
      || layer.query.providerId === "csm.mission-arena"
      || layer.query.providerId === "sim.flight-data"
      || layer.query.providerId === "sim.situation-data"
      || layer.query.providerId === "sim.safety-data"
      || layer.query.providerId === "sim.tak-gateway"))
    || layer.layerId === "flight.public.tracks"
    || layer.layerId === "flight.sim.tracks"
    || layer.layerId === "user.zone.alerts"
    || layer.layerId === "user.sketch.drawings";
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
    .filter((layer) => (layer.query.mode === "bbox" || layer.query.mode === "grid") && layer.query.providerId === providerId)
    .map((layer) => layer.layerId);
}

function selectedSituationRasterRefreshSeconds(catalog: MapCatalogResponse | null, selectedLayerIds: string[]): number | undefined {
  if (!catalog) {
    return undefined;
  }
  const selected = new Set(selectedLayerIds);
  const refreshSeconds = catalog.layers
    .filter((layer) => selected.has(layer.layerId))
    .filter((layer) => layer.query.providerId === "sim.situation-data" && layer.kind === "raster_overlay")
    .map((layer) => layer.refreshSeconds)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (refreshSeconds.length === 0) {
    return undefined;
  }
  const seconds = Math.min(...refreshSeconds);
  return Math.max(60, Math.min(seconds, 900));
}

function isWeatherRadarCatalogLayerId(layerId: string): boolean {
  return layerId === "public.weather.radar_reflectivity"
    || layerId === "public.weather.radar_precipitation"
    || layerId === "public.weather.radar_nowcast"
    || layerId === "public.safety.thunderstorm_risk";
}

function normalizeWeatherRadarFrames(response: { frames?: WeatherRadarFrame[]; products?: Array<{ frames?: WeatherRadarFrame[] }> }): WeatherRadarFrame[] {
  const frames = [
    ...(Array.isArray(response.frames) ? response.frames : []),
    ...(Array.isArray(response.products) ? response.products.flatMap((product) => Array.isArray(product.frames) ? product.frames : []) : [])
  ]
    .filter((frame) => typeof frame.cleanUrl === "string" && frame.cleanUrl.length > 0 && typeof frame.observedAt === "string")
    .sort((a, b) => Date.parse(a.observedAt ?? "") - Date.parse(b.observedAt ?? ""));
  const seen = new Set<string>();
  return frames.filter((frame) => {
    const key = `${frame.productId ?? ""}:${frame.cleanUrl}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function applyWeatherRadarFrameToSituationFeatures(
  collection: SituationFeatureCollectionResponse | null,
  frame: WeatherRadarFrame | undefined
): SituationFeatureCollectionResponse | null {
  if (!collection || !frame?.cleanUrl) {
    return collection;
  }
  let changed = false;
  const features = collection.features.map((feature) => {
    if (!isWeatherRadarSituationFeature(feature)) {
      return feature;
    }
    const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
    const raster = isRecord(providerProperties.raster) ? providerProperties.raster : {};
    changed = true;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        providerProperties: {
          ...providerProperties,
          raster: {
            ...raster,
            boundsWgs84: frame.boundsWgs84 ?? raster.boundsWgs84,
            dataBoundsWgs84: frame.dataBoundsWgs84 ?? raster.dataBoundsWgs84,
            observedAt: frame.observedAt ?? raster.observedAt,
            opacity: frame.opacity ?? raster.opacity,
            url: frame.cleanUrl
          }
        }
      }
    };
  });
  return changed ? { ...collection, features } : collection;
}

function isWeatherRadarSituationFeature(feature: SituationFeature): boolean {
  return isWeatherRadarCatalogLayerId(feature.properties.layerId ?? "")
    || feature.properties.layer === "weather_radar_reflectivity"
    || feature.properties.layer === "weather_radar_precipitation"
    || feature.properties.layer === "weather_radar_nowcast"
    || feature.properties.layer === "weather_thunderstorm_risk";
}

function formatWeatherRadarFrameTime(frame: WeatherRadarFrame | undefined): string {
  if (!frame?.observedAt) {
    return "aktuální";
  }
  const date = new Date(frame.observedAt);
  if (Number.isNaN(date.getTime())) {
    return "aktuální";
  }
  return date.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

function withOutlineBoundaryLayer(selectedLayerIds: string[], mode: MapBasemapMode, catalog: MapCatalogResponse | null): string[] {
  if (mode !== "outline" || !catalog) {
    return selectedLayerIds;
  }
  const preferredBoundaryLayers = ["public.boundary.country", "public.boundary.region", "public.boundary.admin"];
  const availableBoundaryLayers = preferredBoundaryLayers.filter((layerId) =>
    catalog.layers.some((layer) => layer.layerId === layerId && isImplementedCatalogLayer(layer))
  );
  const missingBoundaryLayers = availableBoundaryLayers.filter((layerId) => !selectedLayerIds.includes(layerId));
  if (missingBoundaryLayers.length === 0) {
    return selectedLayerIds;
  }
  return [...selectedLayerIds, ...missingBoundaryLayers];
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
  if (layer.layerId === "user.sketch.drawings") {
    return false;
  }
  if (layer.query.providerId === "sim.situation-data") {
    const layerMatch = providerLayerIds.some((layerId) => {
      const situationLayerId = situationLayerIdFromProviderLayerId(layerId);
      return Boolean(situationLayerId && selection.situationLayerIds.includes(situationLayerId));
    });
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
        const situationLayerId = situationLayerIdFromProviderLayerId(providerLayerId);
        if (situationLayerId) {
          situationLayerIds.add(situationLayerId);
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
      const situationLayerId = situationLayerIdFromProviderLayerId(providerLayerId);
      if (!situationLayerId || situationLayerId === "mobile" || situationLayerId === "mobile_coverage") {
        continue;
      }
      const current = layers.get(situationLayerId);
      layers.set(situationLayerId, mergeSituationLayer(current, situationLayerId, catalogLayer));
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
      layers: Array.from(new Set(providerLayerIdsForCatalogSource(catalog, source)
        .map(situationLayerIdFromProviderLayerId)
        .filter((value): value is SituationLayerId => Boolean(value)))),
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
    .filter((layer) => layer.selectable && (layer.query.mode === "bbox" || layer.query.mode === "grid") && layer.query.providerId === providerId)
    .filter((layer) => (layer.query.providerLayerIds ?? []).some((layerId) => {
      if (selectedLayers.has(layerId)) {
        return true;
      }
      const situationLayerId = providerId === "sim.situation-data" ? situationLayerIdFromProviderLayerId(layerId) : undefined;
      return Boolean(situationLayerId && selectedLayers.has(situationLayerId));
    }))
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
    || value === "gdacs_alerts"
    || value === "hzs_incidents"
    || value === "mock"
    || value === "nasa_firms"
    || value === "road_srti_lod"
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
  return value === "civil" || value === "risk" || value === "dark" || value === "outline" ? value : "standard";
}

function isWebKitRuntime(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const userAgent = navigator.userAgent;
  return /AppleWebKit/u.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox/u.test(userAgent);
}

function normalizeAppLanguage(value: string | undefined): AppLanguage {
  return value === "en" ? "en" : "cs";
}

function appLanguageToLocale(value: AppLanguage): string {
  return value === "en" ? "en-US" : "cs-CZ";
}

function appLanguageToGeocodeLanguage(value: AppLanguage): string {
  return value === "en" ? "en,cs" : "cs,en";
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
    || value === "weather_temperature_grid"
    || value === "weather_webcams"
    || value === "weather_wind_field"
    || value === "weather_precipitation_grid"
    || value === "weather_humidity_grid"
    || value === "weather_pressure_grid"
    || value === "weather_radar_reflectivity"
    || value === "weather_radar_precipitation"
    || value === "weather_radar_nowcast"
    || value === "weather_thunderstorm_risk"
    || value === "boundary_admin"
    || value === "boundary_country"
    || value === "boundary_region"
    || value === "boundary_district"
    || value === "boundary_orp"
    || value === "boundary_municipality"
    || value === "community"
    || value === "fire"
    || value === "flight_airports"
    || value === "flight_airspaces"
    || value === "ground"
    || value === "mobile"
    || value === "mobile_coverage"
    || value === "mobile_network"
    || value === "mission_arena"
    || value === "place_settlements"
    || value === "traffic"
    || value === "warnings"
    || value === "weather_alerts"
    || value === "flood"
    || value === "air_quality"
    || value === "air_quality_grid";
}

function situationLayerIdFromProviderLayerId(value: string): SituationLayerId | undefined {
  if (isSituationLayerId(value)) {
    return value;
  }
  switch (value) {
    case "air_quality.grid":
    case "air_quality_grid":
    case "public.safety.air_quality_grid":
      return "air_quality_grid";
    case "weather.humidity":
    case "weather.humidity_grid":
    case "public.weather.humidity_grid":
      return "weather_humidity_grid";
    case "weather.precipitation":
    case "weather.precipitation_grid":
    case "public.weather.precipitation_grid":
      return "weather_precipitation_grid";
    case "weather.pressure":
    case "weather.pressure_grid":
    case "public.weather.pressure_grid":
      return "weather_pressure_grid";
    case "weather.webcams":
    case "weather_webcams":
    case "public.weather.webcams":
      return "weather_webcams";
    case "weather.radar_nowcast":
    case "weather_radar_nowcast":
    case "public.weather.radar_nowcast":
      return "weather_radar_nowcast";
    case "weather.radar_precipitation":
    case "weather_radar_precipitation":
    case "public.weather.radar_precipitation":
      return "weather_radar_precipitation";
    case "weather.radar_reflectivity":
    case "weather_radar_reflectivity":
    case "public.weather.radar_reflectivity":
      return "weather_radar_reflectivity";
    case "weather.temperature":
    case "weather.temperature_grid":
    case "public.weather.temperature_grid":
      return "weather_temperature_grid";
    case "weather.thunderstorm_risk":
    case "weather_thunderstorm_risk":
    case "public.safety.thunderstorm_risk":
      return "weather_thunderstorm_risk";
    case "weather.wind":
    case "weather.wind_field":
    case "public.weather.wind_field":
      return "weather_wind_field";
    default:
      return undefined;
  }
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

function readMessagingDockWidth(): number {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return 640;
  }
  try {
    const stored = Number(window.localStorage.getItem(messagingDockWidthStorageKey));
    return Number.isFinite(stored) ? clamp(stored, messagingDockWidthRange.min, messagingDockWidthRange.max) : 640;
  } catch {
    return 640;
  }
}

function writeMessagingDockWidth(width: number): void {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return;
  }
  try {
    window.localStorage.setItem(messagingDockWidthStorageKey, String(clamp(width, messagingDockWidthRange.min, messagingDockWidthRange.max)));
  } catch {
    // Local storage can be disabled in private/degraded browser contexts.
  }
}

export function buildStableSituationQueryBounds(bounds: MapBounds): MapBounds {
  const width = Math.max(0.01, Math.abs(bounds.east - bounds.west));
  const height = Math.max(0.01, Math.abs(bounds.north - bounds.south));
  const centerLon = (bounds.east + bounds.west) / 2;
  const centerLat = (bounds.north + bounds.south) / 2;
  const queryWidth = Math.min(11, Math.max(width * 1.8, 1.2));
  const queryHeight = Math.min(7, Math.max(height * 1.8, 0.9));
  return snapBoundsToGrid({
    east: centerLon + queryWidth / 2,
    north: centerLat + queryHeight / 2,
    south: centerLat - queryHeight / 2,
    west: centerLon - queryWidth / 2
  }, 0.25);
}

export function mapBoundsContainedBy(container: MapBounds, bounds: MapBounds): boolean {
  const epsilon = 0.000001;
  return bounds.west >= container.west - epsilon
    && bounds.east <= container.east + epsilon
    && bounds.south >= container.south - epsilon
    && bounds.north <= container.north + epsilon;
}

function snapBoundsToGrid(bounds: MapBounds, gridDegrees: number): MapBounds {
  return {
    east: roundBoundsCoordinate(Math.ceil(bounds.east / gridDegrees) * gridDegrees),
    north: roundBoundsCoordinate(Math.ceil(bounds.north / gridDegrees) * gridDegrees),
    south: roundBoundsCoordinate(Math.floor(bounds.south / gridDegrees) * gridDegrees),
    west: roundBoundsCoordinate(Math.floor(bounds.west / gridDegrees) * gridDegrees)
  };
}

function roundBoundsCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function stableSituationRequestKey(layerIds: string[], filters: Record<string, Record<string, unknown>>): string {
  return JSON.stringify({
    filters,
    layerIds: [...layerIds].sort()
  });
}

function shouldSkipSituationFeatureLoad(bounds: MapBounds, zoom: number | undefined): boolean {
  void bounds;
  void zoom;
  return false;
}

function shouldSkipSafetyFeatureLoad(bounds: MapBounds, zoom: number | undefined): boolean {
  void bounds;
  void zoom;
  return false;
}

function sourceQualityWarnings(warnings: string[]): string[] {
  const labels = warnings
    .map(sourceQualityWarningText)
    .filter((warning) => warning.length > 0);
  return Array.from(new Set(labels));
}

function sourceQualityWarningText(warning: string): string {
  const normalized = warning.trim();
  if (!normalized) {
    return "";
  }
  const lower = normalized.toLowerCase();
  if (
    lower.includes("stale")
    || lower.includes("expired")
    || lower.includes("freshness")
    || lower.includes("age")
    || lower.includes("cache")
    || lower.includes("old")
  ) {
    return "Některá data jsou starší. Mapa zůstává dostupná a kvalitu zdroje najdete v panelu Zdroje.";
  }
  if (
    lower.includes("degraded")
    || lower.includes("warning")
    || lower.includes("provider")
    || lower.includes("source")
    || lower.includes("partial")
  ) {
    return "Některý zdroj běží v omezené kvalitě. Zobrazení pokračuje s dostupnými daty.";
  }
  if (
    lower.includes("timeout")
    || lower.includes("aborted")
    || lower.includes("unavailable")
    || lower.includes("failed")
    || lower.includes("fetch")
    || lower.includes("network")
  ) {
    return "Některý zdroj se dočasně nenačetl. Aplikace používá dostupná data.";
  }
  return normalized.length > 120
    ? "Některý zdroj vrátil provozní upozornění. Detail je dostupný v panelu Zdroje."
    : normalized;
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
