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
  MapPin,
  Pause,
  Play,
  RefreshCw,
  RadioTower,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wifi
} from "lucide-react";
import {
  fetchCopDashboardData,
  filterObjectsByLayer,
  filterVisibleObjects,
  getDataQualityCount,
  getUavCount,
  type CopLayer,
  type CopObject,
  type HealthStatus,
  type SourceSystem
} from "./cop-data";
import { CopMap } from "./CopMap";
import { buildProximityAlerts, type ProximityAlert, type UserLocation } from "./proximity-alerts";
import { getAffiliationPresentation, getNatoSidc, resolveCopObjectSymbol } from "./symbology";
import {
  normalizeRefreshSeconds,
  parseRefreshSeconds,
  refreshMillisecondsToSeconds,
  REFRESH_OPTIONS,
  type RefreshSeconds
} from "./refresh-config";
import { countHistoryPoints, mergeTrackHistory, type TrackHistory } from "./track-history";
import {
  clamp,
  normalizeMapView,
  readUserPreferences,
  writeUserPreferences,
  type MapViewState
} from "./user-preferences";
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

interface DashboardMetrics {
  activeSources: number;
  avgConfidence: number;
  foreignCount: number;
  friendlyCount: number;
  lowConfidenceCount: number;
  syntheticCount: number;
  warningCount: number;
}

export function App() {
  const initialPreferences = React.useMemo(() => readUserPreferences(), []);
  const [health, setHealth] = React.useState<HealthStatus | null>(null);
  const [sources, setSources] = React.useState<SourceSystem[]>([]);
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
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [autoRefresh, setAutoRefresh] = React.useState(() => readInitialAutoRefresh(initialPreferences.autoRefresh));
  const [refreshSeconds, setRefreshSeconds] = React.useState<RefreshSeconds>(() =>
    readInitialRefreshSeconds(normalizeRefreshSeconds(initialPreferences.refreshSeconds ?? defaultRefreshSeconds))
  );
  const [replayRunning, setReplayRunning] = React.useState(false);
  const [replayPosition, setReplayPosition] = React.useState(72);
  const [showHistory, setShowHistory] = React.useState(() => readInitialMapToggle("history", initialPreferences.showHistory ?? false));
  const [showPrediction, setShowPrediction] = React.useState(() =>
    readInitialMapToggle("prediction", initialPreferences.showPrediction ?? false)
  );
  const [predictionMinutes, setPredictionMinutes] = React.useState(() => clamp(initialPreferences.predictionMinutes ?? 10, 2, 20));
  const [trackHistory, setTrackHistory] = React.useState<TrackHistory>({});
  const [autoFit, setAutoFit] = React.useState(initialPreferences.autoFit ?? true);
  const [mapView, setMapView] = React.useState<MapViewState | undefined>(() => normalizeMapView(initialPreferences.mapView));
  const [userLocation, setUserLocation] = React.useState<UserLocation | null>(null);
  const [focusUserLocationRequest, setFocusUserLocationRequest] = React.useState(0);
  const [locationStatus, setLocationStatus] = React.useState("Poloha není zaměřená.");
  const [isLocating, setIsLocating] = React.useState(false);
  const [proximityAlertEnabled, setProximityAlertEnabled] = React.useState(initialPreferences.proximityAlertEnabled ?? false);
  const [alertRadiusKm, setAlertRadiusKm] = React.useState(() => clamp(initialPreferences.alertRadiusKm ?? 10, 1, 50));
  const [aiResult, setAiResult] = React.useState("Mock AI provider připraven pro dotazy nad COP daty.");
  const loadInFlightRef = React.useRef(false);
  const notifiedProximityAlertsRef = React.useRef<Set<string>>(new Set());

  const load = React.useCallback(async () => {
    if (loadInFlightRef.current) {
      return;
    }
    loadInFlightRef.current = true;
    setIsLoading(true);
    try {
      const data = await fetchCopDashboardData(apiBase, labToken);
      const observedAt = new Date();
      setHealth(data.health);
      setSources(data.sources);
      setObjects(data.objects);
      setTrackHistory((current) => mergeTrackHistory(current, data.objects, observedAt.toISOString()));
      setLastLoadedAt(observedAt.toLocaleTimeString("cs-CZ"));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Nepodařilo se načíst COP data.");
    } finally {
      loadInFlightRef.current = false;
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!autoRefresh) {
      return;
    }
    const timer = window.setInterval(() => {
      void load();
    }, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load, refreshSeconds]);

  React.useEffect(() => {
    if (!replayRunning) {
      return;
    }
    const timer = window.setInterval(() => {
      setReplayPosition((current) => (current >= 100 ? 0 : current + 2));
    }, 800);
    return () => window.clearInterval(timer);
  }, [replayRunning]);

  const baseFilteredObjects = React.useMemo(
    () => filterVisibleObjects(objects, { includeSynthetic, minConfidence }),
    [includeSynthetic, minConfidence, objects]
  );
  const scopedObjects = React.useMemo(
    () => applyOperationalFilters(baseFilteredObjects, affiliationScope, domainScope, searchQuery),
    [affiliationScope, baseFilteredObjects, domainScope, searchQuery]
  );
  const visibleObjects = React.useMemo(
    () => filterObjectsByLayer(scopedObjects, selectedLayer),
    [scopedObjects, selectedLayer]
  );
  const selectedObject = visibleObjects.find((object) => object.objectId === selectedObjectId) ?? visibleObjects[0];
  const metrics = React.useMemo(() => buildMetrics(scopedObjects, sources), [scopedObjects, sources]);
  const eventStream = React.useMemo(() => buildEventStream(visibleObjects), [visibleObjects]);
  const historyPointCount = React.useMemo(
    () => countHistoryPoints(trackHistory, visibleObjects),
    [trackHistory, visibleObjects]
  );
  const proximityAlerts = React.useMemo(
    () =>
      proximityAlertEnabled
        ? buildProximityAlerts(baseFilteredObjects, userLocation, trackHistory, alertRadiusKm, predictionMinutes)
        : [],
    [alertRadiusKm, baseFilteredObjects, predictionMinutes, proximityAlertEnabled, trackHistory, userLocation]
  );

  React.useEffect(() => {
    writeUserPreferences({
      affiliationScope,
      alertRadiusKm,
      autoFit,
      autoRefresh,
      domainScope,
      includeSynthetic,
      mapView,
      minConfidence,
      predictionMinutes,
      proximityAlertEnabled,
      refreshSeconds,
      selectedLayer,
      showHistory,
      showPrediction
    });
  }, [
    affiliationScope,
    alertRadiusKm,
    autoFit,
    autoRefresh,
    domainScope,
    includeSynthetic,
    mapView,
    minConfidence,
    predictionMinutes,
    proximityAlertEnabled,
    refreshSeconds,
    selectedLayer,
    showHistory,
    showPrediction
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
        Authorization: `Bearer ${labToken}`
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
          <StatusItem icon={<RadioTower size={16} />} label="Sources" value={String(sources.length)} tone={metrics.activeSources > 0 ? "ok" : "warn"} />
          <StatusItem icon={<Database size={16} />} label="Objects" value={String(visibleObjects.length)} tone="neutral" />
          <StatusItem icon={<Bot size={16} />} label="AI" value="mock" tone="neutral" />
        </div>
      </header>

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
          <div className="refresh-control">
            <label className="toggle-row compact">
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
              Auto refresh
            </label>
            <div className="refresh-segment" aria-label="Interval automatického obnovování">
              {REFRESH_OPTIONS.map((option) => (
                <button
                  aria-pressed={refreshSeconds === option}
                  className={refreshSeconds === option ? "active" : ""}
                  key={option}
                  onClick={() => setRefreshSeconds(option)}
                  type="button"
                >
                  {option}s
                </button>
              ))}
            </div>
          </div>
          {loadError ? <div className="error-banner">API chyba: {loadError}. Poslední platná data zůstávají zobrazena.</div> : null}

          <div className="mission-metrics">
            <MetricTile label="Friendly" value={metrics.friendlyCount} tone="friend" />
            <MetricTile label="Foreign" value={metrics.foreignCount} tone="hostile" />
            <MetricTile label="Confidence" value={`${metrics.avgConfidence}%`} tone={metrics.avgConfidence >= 75 ? "ok" : "warn"} />
            <MetricTile label="Warnings" value={metrics.warningCount} tone={metrics.warningCount > 0 ? "warn" : "ok"} />
          </div>

          <PanelTitle icon={<Layers size={17} />} title="Vrstvy" />
          <LayerButton active={selectedLayer === "air-situation"} onClick={() => setSelectedLayer("air-situation")} label="Air situation" count={scopedObjects.length} />
          <LayerButton active={selectedLayer === "uav"} onClick={() => setSelectedLayer("uav")} label="UAV" count={getUavCount(scopedObjects)} />
          <LayerButton active={selectedLayer === "friendly"} onClick={() => setSelectedLayer("friendly")} label="Vlastní" count={metrics.friendlyCount} />
          <LayerButton active={selectedLayer === "foreign"} onClick={() => setSelectedLayer("foreign")} label="Cizí" count={metrics.foreignCount} />
          <LayerButton active={selectedLayer === "data-quality"} onClick={() => setSelectedLayer("data-quality")} label="Data quality" count={getDataQualityCount(scopedObjects)} />
          <div className="map-layer-options">
            <label className="toggle-row compact">
              <input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />
              Historie trasy
            </label>
            <label className="toggle-row compact">
              <input type="checkbox" checked={showPrediction} onChange={(event) => setShowPrediction(event.target.checked)} />
              Predikce pohybu
            </label>
            <label className="range-label compact">
              Horizont predikce
              <input
                type="range"
                min="2"
                max="20"
                step="1"
                value={predictionMinutes}
                onChange={(event) => setPredictionMinutes(Number(event.target.value))}
              />
              <span>{predictionMinutes} min</span>
            </label>
          </div>

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
        </aside>

        <section className="center-column">
          <section className="map-stage">
            <CopMap
              objects={visibleObjects}
              selectedLayer={selectedLayer}
              selectedObjectId={selectedObject?.objectId}
              showHistory={showHistory}
              showPrediction={showPrediction}
              trackHistory={trackHistory}
              predictionMinutes={predictionMinutes}
              autoFit={autoFit}
              alertRadiusKm={alertRadiusKm}
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
                <button className="mini-button" onClick={() => setReplayRunning((current) => !current)} type="button">
                  {replayRunning ? <Pause size={14} /> : <Play size={14} />}
                  {replayRunning ? "Pause" : "Play"}
                </button>
              </div>
              <div className="timeline">
                <Clock3 size={18} />
                <div className="timeline-rail" aria-label="Replay position">
                  <span style={{ width: `${replayPosition}%` }} />
                </div>
                <strong>
                  {visibleObjects.length} tracků · {historyPointCount} bodů
                </strong>
              </div>
              <EventStream events={eventStream} />
            </div>
          </section>
        </section>

        <aside className="panel right-panel">
          <PanelTitle icon={<Database size={17} />} title="Object detail" />
          {selectedObject ? (
            <ObjectDetail object={selectedObject} />
          ) : (
            <div className="empty-state">Zatím nejsou přijata žádná COP data. Pošli validní ingest event ze SIM fixture.</div>
          )}

          <div className="readiness-box">
            <PanelTitle icon={<Gauge size={17} />} title="Data readiness" />
            <ReadinessRow label="Source coverage" value={metrics.activeSources > 0 ? "active" : "waiting"} tone={metrics.activeSources > 0 ? "ok" : "warn"} />
            <ReadinessRow label="SIM data visible" value={includeSynthetic ? "enabled" : "hidden"} tone={includeSynthetic ? "ok" : "warn"} />
            <ReadinessRow label="SIM tracks" value={String(metrics.syntheticCount)} tone="neutral" />
            <ReadinessRow label="Refresh rate" value={autoRefresh ? `${refreshSeconds} s` : "manual"} tone={autoRefresh ? "ok" : "neutral"} />
            <ReadinessRow label="Track history" value={showHistory ? `${historyPointCount} pts` : "hidden"} tone={showHistory ? "ok" : "neutral"} />
            <ReadinessRow label="Prediction horizon" value={showPrediction ? `${predictionMinutes} min` : "hidden"} tone={showPrediction ? "ok" : "neutral"} />
            <ReadinessRow label="Policy scope" value="COP data only" tone="neutral" />
          </div>

          <div className="personal-awareness-box">
            <PanelTitle icon={<MapPin size={17} />} title="Moje poloha" />
            <button className="primary-button secondary" disabled={isLocating} onClick={locateUser} type="button">
              <MapPin size={16} />
              {isLocating ? "Zaměřuji polohu" : "Centrovat na mou polohu"}
            </button>
            <p>{locationStatus}</p>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={proximityAlertEnabled}
                onChange={(event) => void handleProximityAlertToggle(event.target.checked)}
              />
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
                onChange={(event) => setAlertRadiusKm(Number(event.target.value))}
              />
              <span>{alertRadiusKm} km</span>
            </label>
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

function StatusItem({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "ok" | "warn" | "neutral" }) {
  return (
    <div className={`status-item ${tone}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricTile({ label, value, tone }: { label: string; value: string | number; tone: "friend" | "hostile" | "ok" | "warn" }) {
  return (
    <div className={`metric-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
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

function ObjectDetail({ object }: { object: CopObject }) {
  const symbol = resolveCopObjectSymbol(object);
  const affiliation = getAffiliationPresentation(object.affiliation);
  const sidc = getNatoSidc(object.objectType, object.affiliation);

  return (
    <div className="object-detail">
      <div className="object-header">
        <div>
          <strong>{object.objectType}</strong>
          <span>{object.objectId}</span>
        </div>
        <em>{object.status}</em>
      </div>
      <dl>
        <div>
          <dt>Affiliation</dt>
          <dd>
            <span className={`affiliation-chip ${affiliation.disposition}`}>{affiliation.label}</span>
            {object.affiliation}
          </dd>
        </div>
        <div>
          <dt>Domain</dt>
          <dd>{object.domain}</dd>
        </div>
        <div>
          <dt>NATO symbol</dt>
          <dd>{symbol.symbolCode}</dd>
        </div>
        <div>
          <dt>SIDC</dt>
          <dd>{sidc}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{Math.round((object.confidence ?? 0) * 100)} %</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>{formatPosition(object)}</dd>
        </div>
        <div>
          <dt>Movement</dt>
          <dd>{formatMovement(object)}</dd>
        </div>
        <div>
          <dt>Age</dt>
          <dd>{formatAge(object.lastUpdatedAt)}</dd>
        </div>
      </dl>
      <div className="object-flags">
        {object.synthetic ? <span className="synthetic-badge">SIM</span> : null}
        {(object.confidence ?? 0) < 0.5 ? <span className="warning-badge">LOW CONFIDENCE</span> : null}
      </div>
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

function formatPosition(object: CopObject): string {
  if (!object.position) {
    return "n/a";
  }
  const altitude = typeof object.position.altitudeM === "number" ? ` · ${Math.round(object.position.altitudeM)} m` : "";
  return `${object.position.lat.toFixed(3)}, ${object.position.lon.toFixed(3)}${altitude}`;
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

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
