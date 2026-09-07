import React from "react";
import {
  CallbackPositionProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  defined,
  EllipsoidTerrainProvider,
  HeightReference,
  HorizontalOrigin,
  ImageryLayer,
  LabelStyle,
  Math as CesiumMath,
  NearFarScalar,
  OpenStreetMapImageryProvider,
  PolylineDashMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  Viewer,
  type Entity
} from "cesium";
import { ArrowLeft, Box, Clock3, Copy, Eye, History, LocateFixed, RefreshCw, Share2, Zap } from "lucide-react";
import { fetchCopDashboardData, isPublicFlightObject, type CopDashboardData, type CopObject } from "./cop-data";
import {
  assessGlobeCapability,
  decodeGlobeShareState,
  encodeGlobeShareState,
  globeHistoryCoordinates,
  projectedGlobePosition,
  type GlobeShareState
} from "./globe-state";
import { createNavigationAuthority } from "./navigation-authority";
import { formatTrackLabel } from "./track-label";
import { useDocumentVisible } from "./use-document-visibility";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./globe.css";

const apiBase = import.meta.env.VITE_COP_API_BASE_URL ?? "";
const labToken = import.meta.env.VITE_COP_PUBLIC_LAB_VALUE ?? (import.meta.env.DEV ? "dev-lab-token" : "");
const czechOverview = { height: 650_000, lat: 49.7437, lon: 15.3386 };

type GlobeMode = "balanced" | "limited";

interface GlobeRuntime {
  entitiesByObjectId: Map<string, Entity>;
  handler: ScreenSpaceEventHandler;
  viewer: Viewer;
}

export default function GlobeWorkspace() {
  const documentVisible = useDocumentVisible();
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const runtimeRef = React.useRef<GlobeRuntime | null>(null);
  const loadInFlightRef = React.useRef(false);
  const navigationAuthorityRef = React.useRef(createNavigationAuthority());
  const initialShareStateRef = React.useRef(decodeGlobeShareState(window.location.hash));
  const capability = React.useMemo(readGlobeCapability, []);
  const [activated, setActivated] = React.useState(false);
  const [mode, setMode] = React.useState<GlobeMode>(capability.mode === "limited" ? "limited" : "balanced");
  const [dashboard, setDashboard] = React.useState<CopDashboardData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = React.useState<string | null>(null);
  const [selectedObjectId, setSelectedObjectId] = React.useState<string | null>(
    initialShareStateRef.current?.selectedObjectId ?? null
  );
  const [showHistory, setShowHistory] = React.useState(initialShareStateRef.current?.history ?? true);
  const [showPredictions, setShowPredictions] = React.useState(initialShareStateRef.current?.predictions ?? true);
  const [shareMessage, setShareMessage] = React.useState<string | null>(null);
  const [, setPositionTick] = React.useState(0);
  const shareOptionsRef = React.useRef({ selectedObjectId, showHistory, showPredictions });
  shareOptionsRef.current = { selectedObjectId, showHistory, showPredictions };

  const maxObjects = mode === "limited" ? 70 : 220;
  const objects = React.useMemo(
    () => (dashboard?.objects ?? []).filter((object) => projectedGlobePosition(object) !== null).slice(0, maxObjects),
    [dashboard?.objects, maxObjects]
  );
  const selectedObject = objects.find((object) => object.objectId === selectedObjectId) ?? null;
  const selectedPosition = selectedObject ? projectedGlobePosition(selectedObject) : null;

  const loadDashboard = React.useCallback(async () => {
    if (!activated || loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    setLoading(true);
    try {
      const response = await fetchCopDashboardData(apiBase, labToken || undefined, {
        limit: mode === "limited" ? 70 : 220,
        seconds: mode === "limited" ? 300 : 900
      });
      setDashboard(response);
      setLastLoadedAt(new Date().toLocaleTimeString("cs-CZ"));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "3D situační data se nepodařilo načíst.");
    } finally {
      loadInFlightRef.current = false;
      setLoading(false);
    }
  }, [activated, mode]);

  React.useEffect(() => {
    if (!activated || !documentVisible) return undefined;
    void loadDashboard();
    const timer = window.setInterval(() => void loadDashboard(), mode === "limited" ? 30_000 : 15_000);
    return () => window.clearInterval(timer);
  }, [activated, documentVisible, loadDashboard, mode]);

  React.useEffect(() => {
    if (!activated || !mountRef.current) return undefined;
    const mount = mountRef.current;
    let viewer: Viewer;
    try {
      viewer = createViewer(mount, initialShareStateRef.current, setRenderError);
    } catch (error) {
      setRenderError(globeRenderErrorMessage(error));
      return undefined;
    }
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    const runtime: GlobeRuntime = { entitiesByObjectId: new Map(), handler, viewer };
    runtimeRef.current = runtime;

    const claimUserCamera = () => navigationAuthorityRef.current.claim("user");
    const canvas = viewer.scene.canvas;
    canvas.setAttribute("aria-label", "Interaktivní 3D mapa České republiky");
    canvas.addEventListener("pointerdown", claimUserCamera, { passive: true });
    canvas.addEventListener("wheel", claimUserCamera, { passive: true });
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(movement.position) as { id?: Entity } | undefined;
      const objectId = defined(picked?.id) ? objectIdFromEntity(picked.id) : null;
      if (objectId) {
        navigationAuthorityRef.current.claim("selection");
        setSelectedObjectId(objectId);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    const writeCameraState = () => {
      const options = shareOptionsRef.current;
      const state = currentShareState(viewer, options.showHistory, options.showPredictions, options.selectedObjectId);
      if (!state) return;
      const url = new URL(window.location.href);
      url.hash = encodeGlobeShareState(state);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    };
    viewer.camera.moveEnd.addEventListener(writeCameraState);

    return () => {
      viewer.camera.moveEnd.removeEventListener(writeCameraState);
      canvas.removeEventListener("pointerdown", claimUserCamera);
      canvas.removeEventListener("wheel", claimUserCamera);
      handler.destroy();
      viewer.destroy();
      runtimeRef.current = null;
    };
  }, [activated]);

  React.useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    renderObjects(runtime, objects, dashboard?.trackHistory ?? {}, {
      selectedObjectId,
      showHistory: showHistory && mode === "balanced",
      showPredictions
    });
  }, [dashboard?.trackHistory, mode, objects, selectedObjectId, showHistory, showPredictions]);

  React.useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !activated || !documentVisible) return undefined;
    const timer = window.setInterval(
      () => {
        runtime.viewer.scene.requestRender();
        setPositionTick((value) => value + 1);
      },
      mode === "limited" ? 1_000 : 250
    );
    return () => window.clearInterval(timer);
  }, [activated, documentVisible, mode]);

  React.useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const state = currentShareState(runtime.viewer, showHistory, showPredictions, selectedObjectId);
    if (!state) return;
    const url = new URL(window.location.href);
    url.hash = encodeGlobeShareState(state);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [selectedObjectId, showHistory, showPredictions]);

  function focusSelectedObject() {
    const runtime = runtimeRef.current;
    const object = selectedObject;
    const position = object ? projectedGlobePosition(object) : null;
    if (!runtime || !position) return;
    const ticket = navigationAuthorityRef.current.claim("selection");
    runtime.viewer.camera.flyTo({
      complete: () => {
        if (navigationAuthorityRef.current.isCurrent(ticket)) runtime.viewer.scene.requestRender();
      },
      destination: Cartesian3.fromDegrees(position.lon, position.lat, Math.max(2_500, position.altitudeM + 2_000)),
      duration: capability.reducedMotion ? 0 : 1.1,
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-55), roll: 0 }
    });
  }

  async function shareCurrentView() {
    const runtime = runtimeRef.current;
    const state = runtime ? currentShareState(runtime.viewer, showHistory, showPredictions, selectedObjectId) : null;
    const url = new URL(window.location.href);
    if (state) url.hash = encodeGlobeShareState(state);
    try {
      if (navigator.share) {
        await navigator.share({ title: "COP – 3D situační přehled", url: url.toString() });
      } else {
        await navigator.clipboard.writeText(url.toString());
      }
      setShareMessage("Odkaz na tento 3D pohled je připraven.");
    } catch {
      setShareMessage("Sdílení bylo zrušeno nebo není dostupné.");
    }
  }

  if (!activated) {
    return (
      <main className="globe-launch-shell">
        <section className="globe-launch-card">
          <a className="globe-back-link" href="/">
            <ArrowLeft size={18} /> Zpět do mapy
          </a>
          <div className="globe-launch-icon" aria-hidden="true">
            <Box size={34} />
          </div>
          <span className="globe-eyebrow">Volitelný pracovní prostor</span>
          <h1>3D situační přehled České republiky</h1>
          <p>
            Prostorový pohled pomáhá operátorům číst výšku, živé stopy a souvislosti v území. Načte se až po spuštění a
            používá pouze data poskytovaná COP.
          </p>
          {capability.mode === "unsupported" ? (
            <div className="globe-capability-message error" role="alert">
              {capability.reasons.join(" ")}
            </div>
          ) : capability.reasons.length > 0 ? (
            <div className="globe-capability-message" role="status">
              <strong>Spustí se úsporný režim.</strong> {capability.reasons.join(" ")}
            </div>
          ) : (
            <div className="globe-capability-message success" role="status">
              Zařízení splňuje doporučené podmínky pro vyvážený 3D režim.
            </div>
          )}
          <ul>
            <li>
              <Zap size={17} /> Vykreslování se zastaví, když se scéna nemění.
            </li>
            <li>
              <Eye size={17} /> Odhadnutá poloha je vždy označena a po 20 sekundách se zastaví.
            </li>
            <li>
              <History size={17} /> Historie je omezená a na slabším zařízení se nezapíná.
            </li>
          </ul>
          <button
            className="globe-launch-button"
            disabled={capability.mode === "unsupported"}
            onClick={() => setActivated(true)}
            type="button"
          >
            <Box size={19} /> Spustit 3D přehled
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="globe-shell">
      <header className="globe-topbar">
        <a className="globe-back-link" href="/">
          <ArrowLeft size={17} /> Mapa
        </a>
        <div className="globe-title">
          <span>3D přehled</span>
          <strong>Česká republika</strong>
        </div>
        <div className="globe-actions">
          <button onClick={() => void loadDashboard()} disabled={loading} type="button">
            <RefreshCw className={loading ? "spin" : ""} size={16} /> Obnovit
          </button>
          <button onClick={() => void shareCurrentView()} type="button">
            <Share2 size={16} /> Sdílet
          </button>
        </div>
      </header>

      <section className="globe-layout">
        <div className="globe-viewport" ref={mountRef}>
          {renderError ? (
            <div className="globe-render-fallback" role="alert">
              <strong>3D zobrazení není v tomto prohlížeči dostupné.</strong>
              <span>{renderError}</span>
              <a href="/">Pokračovat ve 2D mapě</a>
            </div>
          ) : null}
        </div>
        <aside className="globe-panel" aria-label="Nastavení a detail 3D mapy">
          <section className="globe-status-card">
            <span className={`globe-mode-badge ${mode}`}>
              {mode === "limited" ? "Úsporný režim" : "Vyvážený režim"}
            </span>
            <strong>{objects.length} objektů v pohledu</strong>
            <small>{lastLoadedAt ? `Aktualizováno ${lastLoadedAt}` : "Čekám na první data"}</small>
            {loadError ? (
              <p className="globe-error" role="alert">
                {loadError}
              </p>
            ) : null}
          </section>

          <section className="globe-controls">
            <label>
              <input
                checked={mode === "limited"}
                onChange={(event) => setMode(event.target.checked ? "limited" : "balanced")}
                type="checkbox"
              />{" "}
              Úsporné vykreslování
            </label>
            <label>
              <input
                checked={showHistory && mode === "balanced"}
                disabled={mode === "limited"}
                onChange={(event) => setShowHistory(event.target.checked)}
                type="checkbox"
              />{" "}
              Historie stop
            </label>
            <label>
              <input
                checked={showPredictions}
                onChange={(event) => setShowPredictions(event.target.checked)}
                type="checkbox"
              />{" "}
              Krátký odhad pohybu
            </label>
          </section>

          <section className="globe-selection-card">
            {selectedObject && selectedPosition ? (
              <>
                <span>Vybraný objekt</span>
                <h2>{formatTrackLabel(selectedObject)}</h2>
                <dl>
                  <div>
                    <dt>Stav polohy</dt>
                    <dd>{positionStateLabel(selectedPosition.state)}</dd>
                  </div>
                  <div>
                    <dt>Stáří</dt>
                    <dd>{formatPositionAge(selectedPosition.ageMs)}</dd>
                  </div>
                  <div>
                    <dt>Typ</dt>
                    <dd>{selectedObject.objectType}</dd>
                  </div>
                  <div>
                    <dt>Důvěra</dt>
                    <dd>{formatConfidence(selectedObject.confidence)}</dd>
                  </div>
                </dl>
                <button onClick={focusSelectedObject} type="button">
                  <LocateFixed size={16} /> Zaměřit objekt
                </button>
              </>
            ) : (
              <>
                <span>Detail</span>
                <h2>Vyberte bod v mapě</h2>
                <p>Kliknutím na objekt zobrazíte původ, aktuálnost a přesnost polohy.</p>
              </>
            )}
          </section>

          <section className="globe-notes">
            <p>
              <Clock3 size={15} /> Přerušovaná čára a stav „odhad“ nejsou nové pozorování.
            </p>
            <p>
              <Copy size={15} /> Sdílený odkaz uchová kameru, filtry a výběr.
            </p>
            {shareMessage ? <small role="status">{shareMessage}</small> : null}
          </section>
        </aside>
      </section>
    </main>
  );
}

function createViewer(
  mount: HTMLElement,
  shareState: GlobeShareState | null,
  onRenderError: (message: string) => void
): Viewer {
  const imagery = new OpenStreetMapImageryProvider({
    credit: "© OpenStreetMap contributors",
    url: "https://tile.openstreetmap.org/"
  });
  const viewer = new Viewer(mount, {
    animation: false,
    baseLayer: new ImageryLayer(imagery),
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    navigationHelpButton: false,
    requestRenderMode: true,
    sceneModePicker: false,
    selectionIndicator: false,
    showRenderLoopErrors: false,
    terrainProvider: new EllipsoidTerrainProvider(),
    timeline: false
  });
  viewer.scene.renderError.addEventListener((_scene, error) => onRenderError(globeRenderErrorMessage(error)));
  const camera = shareState?.camera;
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(
      camera?.lon ?? czechOverview.lon,
      camera?.lat ?? czechOverview.lat,
      camera?.height ?? czechOverview.height
    ),
    orientation: {
      heading: camera?.heading ?? 0,
      pitch: camera?.pitch ?? CesiumMath.toRadians(-88),
      roll: camera?.roll ?? 0
    }
  });
  viewer.scene.globe.enableLighting = false;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
  viewer.scene.requestRender();
  return viewer;
}

function globeRenderErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Zařízení nebo grafický ovladač nedokončil vykreslení scény.";
}

function renderObjects(
  runtime: GlobeRuntime,
  objects: CopObject[],
  history: NonNullable<CopDashboardData["trackHistory"]>,
  options: { selectedObjectId: string | null; showHistory: boolean; showPredictions: boolean }
) {
  const { viewer } = runtime;
  viewer.entities.removeAll();
  runtime.entitiesByObjectId.clear();
  for (const object of objects) {
    const pointPosition = new CallbackPositionProperty((_time, result) => {
      const projected = projectedGlobePosition(object);
      if (!projected) return undefined;
      const altitude = object.domain === "AIR" ? projected.altitudeM : 20;
      return Cartesian3.fromDegrees(projected.lon, projected.lat, altitude, undefined, result);
    }, false);
    const selected = object.objectId === options.selectedObjectId;
    const color = globeObjectColor(object);
    const entity = viewer.entities.add({
      id: `cop-object:${object.objectId}`,
      label: selected
        ? {
            backgroundColor: Color.fromCssColorString("#071827").withAlpha(0.88),
            fillColor: Color.WHITE,
            font: "600 14px system-ui, sans-serif",
            horizontalOrigin: HorizontalOrigin.LEFT,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            pixelOffset: new Cartesian2(14, -8),
            scaleByDistance: new NearFarScalar(1_000, 1, 1_500_000, 0.45),
            showBackground: true,
            style: LabelStyle.FILL_AND_OUTLINE,
            text: formatTrackLabel(object),
            verticalOrigin: VerticalOrigin.CENTER
          }
        : undefined,
      point: {
        color,
        heightReference: object.domain === "AIR" ? HeightReference.NONE : HeightReference.RELATIVE_TO_GROUND,
        outlineColor: selected ? Color.WHITE : Color.fromCssColorString("#071827"),
        outlineWidth: selected ? 3 : 1,
        pixelSize: selected ? 13 : isPublicFlightObject(object) ? 9 : 8,
        scaleByDistance: new NearFarScalar(2_000, 1.2, 2_000_000, 0.35)
      },
      position: pointPosition
    });
    runtime.entitiesByObjectId.set(object.objectId, entity);

    if (options.showHistory) {
      const coordinates = globeHistoryCoordinates(history[object.objectId] ?? []);
      if (coordinates.length >= 6) {
        viewer.entities.add({
          id: `cop-history:${object.objectId}`,
          polyline: {
            clampToGround: object.domain !== "AIR",
            material: color.withAlpha(selected ? 0.8 : 0.42),
            positions: Cartesian3.fromDegreesArrayHeights(coordinates),
            width: selected ? 3 : 1.5
          }
        });
      }
    }

    if (options.showPredictions) {
      const current = projectedGlobePosition(object);
      const future = projectedGlobePosition(object, Date.now() + 12_000);
      if (current && current.state !== "stale" && future?.state === "estimated") {
        const altitude = object.domain === "AIR" ? current.altitudeM : 20;
        viewer.entities.add({
          id: `cop-estimate:${object.objectId}`,
          polyline: {
            clampToGround: object.domain !== "AIR",
            material: new PolylineDashMaterialProperty({ color: color.withAlpha(0.65), dashLength: 12 }),
            positions: Cartesian3.fromDegreesArrayHeights([
              current.lon,
              current.lat,
              altitude,
              future.lon,
              future.lat,
              object.domain === "AIR" ? future.altitudeM : 20
            ]),
            width: selected ? 3 : 1.5
          }
        });
      }
    }
  }
  viewer.scene.requestRender();
}

function currentShareState(
  viewer: Viewer,
  history: boolean,
  predictions: boolean,
  selectedObjectId: string | null
): GlobeShareState | null {
  const cartographic = Cartographic.fromCartesian(viewer.camera.positionWC);
  if (!cartographic) return null;
  return {
    camera: {
      heading: viewer.camera.heading,
      height: cartographic.height,
      lat: CesiumMath.toDegrees(cartographic.latitude),
      lon: CesiumMath.toDegrees(cartographic.longitude),
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll
    },
    history,
    predictions,
    ...(selectedObjectId ? { selectedObjectId } : {}),
    version: 1
  };
}

function objectIdFromEntity(entity: Entity): string | null {
  return entity.id.startsWith("cop-object:") ? entity.id.slice("cop-object:".length) : null;
}

function globeObjectColor(object: CopObject): Color {
  if (isPublicFlightObject(object)) return Color.fromCssColorString("#facc15");
  if (object.affiliation === "FRIEND" || object.affiliation === "ASSUMED_FRIEND")
    return Color.fromCssColorString("#60a5fa");
  if (object.affiliation === "HOSTILE" || object.affiliation === "SUSPECT") return Color.fromCssColorString("#ef4444");
  if (object.affiliation === "NEUTRAL") return Color.fromCssColorString("#22c55e");
  return Color.fromCssColorString("#f59e0b");
}

function readGlobeCapability() {
  const canvas = document.createElement("canvas");
  const webgl2 = Boolean(canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }));
  const extendedNavigator = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  return {
    ...assessGlobeCapability({
      deviceMemory: extendedNavigator.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency,
      reducedMotion,
      saveData: extendedNavigator.connection?.saveData,
      webgl2
    }),
    reducedMotion
  };
}

function positionStateLabel(state: "estimated" | "observed" | "stale"): string {
  if (state === "estimated") return "Odhad mezi měřeními";
  if (state === "stale") return "Zastaralá, bez dalšího odhadu";
  return "Pozorovaná";
}

function formatPositionAge(ageMs: number): string {
  if (ageMs < 1_000) return "právě teď";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)} s`;
  return `${Math.round(ageMs / 60_000)} min`;
}

function formatConfidence(confidence: number | undefined): string {
  return typeof confidence === "number" && Number.isFinite(confidence)
    ? `${Math.round(confidence * 100)} %`
    : "Neuvedena";
}
