import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bot,
  Database,
  Layers,
  RefreshCw,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
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
import { getAffiliationPresentation, resolveCopObjectSymbol } from "./symbology";
import "./styles.css";

const apiBase = import.meta.env.VITE_COP_API_BASE_URL ?? "";
const labToken =
  import.meta.env.VITE_COP_PUBLIC_LAB_VALUE ??
  import.meta.env.VITE_COP_AUTH_VALUE ??
  import.meta.env.VITE_COP_LAB_TOKEN ??
  "dev-lab-token";
const refreshIntervalMs = Number.parseInt(import.meta.env.VITE_COP_REFRESH_MS ?? "5000", 10);

export function App() {
  const [health, setHealth] = React.useState<HealthStatus | null>(null);
  const [sources, setSources] = React.useState<SourceSystem[]>([]);
  const [objects, setObjects] = React.useState<CopObject[]>([]);
  const [selectedLayer, setSelectedLayer] = React.useState<CopLayer>("air-situation");
  const [selectedObjectId, setSelectedObjectId] = React.useState<string | null>(null);
  const [includeSynthetic, setIncludeSynthetic] = React.useState(true);
  const [minConfidence, setMinConfidence] = React.useState(0.2);
  const [lastLoadedAt, setLastLoadedAt] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [aiResult, setAiResult] = React.useState("Mock AI provider připraven pro dotazy nad COP daty.");

  const load = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchCopDashboardData(apiBase, labToken);
      setHealth(data.health);
      setSources(data.sources);
      setObjects(data.objects);
      setLastLoadedAt(new Date().toLocaleTimeString("cs-CZ"));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Nepodařilo se načíst COP data.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [load]);

  const filteredObjects = filterVisibleObjects(objects, { includeSynthetic, minConfidence });
  const visibleObjects = filterObjectsByLayer(filteredObjects, selectedLayer);
  const selectedObject = visibleObjects.find((object) => object.objectId === selectedObjectId) ?? visibleObjects[0];

  React.useEffect(() => {
    if (selectedObjectId && !visibleObjects.some((object) => object.objectId === selectedObjectId)) {
      setSelectedObjectId(null);
    }
  }, [selectedObjectId, visibleObjects]);

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
        prompt: "Shrň kvalitu aktuálního COP pohledu a odliš syntetická data.",
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

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">COP</div>
          <div>
            <h1>ACR COP Data Fabric</h1>
            <p>SITDATA-COP pilotní skeleton</p>
          </div>
        </div>
        <div className="status-strip">
          <StatusItem icon={<Wifi size={16} />} label="API" value={health?.status ?? "loading"} />
          <StatusItem icon={<RadioTower size={16} />} label="Sources" value={String(sources.length)} />
          <StatusItem icon={<Database size={16} />} label="Objects" value={String(visibleObjects.length)} />
          <StatusItem icon={<Bot size={16} />} label="AI" value="mock" />
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
          {loadError ? <div className="error-banner">API chyba: {loadError}. Poslední platná data zůstávají zobrazena.</div> : null}

          <PanelTitle icon={<Layers size={17} />} title="Vrstvy" />
          <LayerButton active={selectedLayer === "air-situation"} onClick={() => setSelectedLayer("air-situation")} label="Air situation" count={filteredObjects.length} />
          <LayerButton active={selectedLayer === "uav"} onClick={() => setSelectedLayer("uav")} label="UAV" count={getUavCount(filteredObjects)} />
          <LayerButton active={selectedLayer === "data-quality"} onClick={() => setSelectedLayer("data-quality")} label="Data quality" count={getDataQualityCount(filteredObjects)} />

          <div className="control-block">
            <PanelTitle icon={<SlidersHorizontal size={17} />} title="Filtry" />
            <label className="toggle-row">
              <input type="checkbox" checked={includeSynthetic} onChange={(event) => setIncludeSynthetic(event.target.checked)} />
              Zobrazit syntetická data
            </label>
            <label className="range-label">
              Minimum confidence
              <input type="range" min="0" max="1" step="0.05" value={minConfidence} onChange={(event) => setMinConfidence(Number(event.target.value))} />
              <span>{Math.round(minConfidence * 100)} %</span>
            </label>
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
              </div>
            ))}
            {sources.length === 0 ? <div className="empty-mini">Source Registry zatím nevrátil žádné zdroje.</div> : null}
          </div>
        </aside>

        <section className="map-stage">
          <CopMap
            objects={visibleObjects}
            selectedLayer={selectedLayer}
            selectedObjectId={selectedObject?.objectId}
            onSelectObject={(object) => setSelectedObjectId(object.objectId)}
          />
          <div className="timeline">
            <Activity size={18} />
            <div className="timeline-rail">
              <span style={{ width: `${Math.min(100, Math.max(16, visibleObjects.length * 2))}%` }} />
            </div>
            <strong>{visibleObjects.length} georeferencovaných tracků</strong>
          </div>
        </section>

        <aside className="panel right-panel">
          <PanelTitle icon={<Database size={17} />} title="Object detail" />
          {selectedObject ? (
            <ObjectDetail object={selectedObject} />
          ) : (
            <div className="empty-state">Zatím nejsou přijata žádná COP data. Pošli validní ingest event ze SIM fixture.</div>
          )}

          <div className="ai-box">
            <PanelTitle icon={<Bot size={17} />} title="AI assistant" />
            <p>{aiResult}</p>
            <button className="primary-button" onClick={askAi}>Zkontrolovat kvalitu dat</button>
          </div>
        </aside>
      </section>
    </main>
  );
}

function StatusItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="status-item">
      {icon}
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

function ObjectDetail({ object }: { object: CopObject }) {
  const symbol = resolveCopObjectSymbol(object);
  const affiliation = getAffiliationPresentation(object.affiliation);

  return (
    <div className="object-detail">
      <div className="object-header">
        <strong>{object.objectType}</strong>
        <span>{object.status}</span>
      </div>
      <dl>
        <div>
          <dt>ID</dt>
          <dd>{object.objectId}</dd>
        </div>
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
          <dt>Confidence</dt>
          <dd>{Math.round((object.confidence ?? 0) * 100)} %</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>{object.position ? `${object.position.lat.toFixed(3)}, ${object.position.lon.toFixed(3)}` : "n/a"}</dd>
        </div>
      </dl>
      {object.synthetic ? <span className="synthetic-badge">SYNTHETIC</span> : null}
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
