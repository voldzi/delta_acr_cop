import React from "react";
import * as THREE from "three";
import { ArrowLeft, Eye, History, Layers, Play, Radar, RefreshCw, Search, Sparkles, Waypoints } from "lucide-react";
import {
  copLayerIds,
  fetchCopDashboardData,
  filterObjectsByLayers,
  filterVisibleObjects,
  isPublicFlightObject,
  type CopLayer,
  type CopDashboardData,
  type CopObject
} from "./cop-data";
import {
  buildXrObjectModels,
  formatXrObjectLabel,
  isSimulatedObject,
  summarizeXrObjects,
  type XrObjectModel
} from "./xr-model";
import { readUserPreferences, type UserPreferences } from "./user-preferences";
import { useDocumentVisible } from "./use-document-visibility";
import "./styles.css";

const apiBase = import.meta.env.VITE_COP_API_BASE_URL ?? "";
const labToken = import.meta.env.VITE_COP_PUBLIC_LAB_VALUE ?? (import.meta.env.DEV ? "dev-lab-token" : "");
const xrTileUrlTemplate = import.meta.env.VITE_COP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const maxXrObjects = 260;
const boardWidthM = 16;
const boardDepthM = 9;

type XrMediaLayout = "apple_mv_hevc" | "mono" | "over_under" | "side_by_side";

interface XrMediaParams {
  layout: XrMediaLayout;
  title: string;
  url: string;
}

interface XrFilters {
  showHistory: boolean;
  showOtherTracks: boolean;
  showPrediction: boolean;
  showPublicFlights: boolean;
  showSimulated: boolean;
}

interface XrSceneHandles {
  camera: THREE.PerspectiveCamera;
  controllers: THREE.Group[];
  input: XrInputState;
  interactive: THREE.Object3D[];
  labels: THREE.Group;
  mapPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  markers: THREE.Group;
  media: THREE.Group;
  panel: THREE.Group;
  panelContent: THREE.Group;
  paths: THREE.Group;
  raycaster: THREE.Raycaster;
  renderer: THREE.WebGLRenderer;
  root: THREE.Group;
  scene: THREE.Scene;
  selectObject: (objectId: string) => void;
}

interface XrInputState {
  grabbedController: THREE.Group | null;
  grabControllerStart: THREE.Vector3;
  grabRootStart: THREE.Vector3;
  panelMaxScroll: number;
  panelScroll: number;
  rootYaw: number;
  zoom: number;
}

type XrSupportState = "checking" | "supported" | "unsupported";

export default function XrWorkspace() {
  const documentVisible = useDocumentVisible();
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const sceneRef = React.useRef<XrSceneHandles | null>(null);
  const dashboardLoadInFlightRef = React.useRef(false);
  const [dashboardData, setDashboardData] = React.useState<CopDashboardData | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [lastLoadedAt, setLastLoadedAt] = React.useState<string | null>(null);
  const [xrSupport, setXrSupport] = React.useState<XrSupportState>("checking");
  const [xrActive, setXrActive] = React.useState(false);
  const [selectedObjectId, setSelectedObjectId] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const xrPreferences = React.useMemo(() => readUserPreferences(), []);
  const [filters, setFilters] = React.useState<XrFilters>({
    showHistory: xrPreferences.showHistory ?? true,
    showOtherTracks: true,
    showPrediction: xrPreferences.showPrediction ?? true,
    showPublicFlights: true,
    showSimulated: xrPreferences.includeSynthetic ?? true
  });
  const xrMedia = React.useMemo(() => readXrMediaParams(), []);

  const objects = dashboardData?.objects ?? [];
  const sources = dashboardData?.sources ?? [];
  const trackHistory = dashboardData?.trackHistory ?? {};
  const preferredObjects = React.useMemo(
    () => selectXrPreferredObjects(objects, xrPreferences),
    [objects, xrPreferences]
  );
  const filteredObjects = React.useMemo(
    () => filterXrObjects(preferredObjects, filters, searchQuery),
    [filters, preferredObjects, searchQuery]
  );
  const objectModels = React.useMemo(
    () => buildXrObjectModels(filteredObjects, trackHistory, { maxObjects: maxXrObjects }),
    [filteredObjects, trackHistory]
  );
  const selectedModel = objectModels.find((model) => model.objectId === selectedObjectId) ?? objectModels[0] ?? null;
  const summary = React.useMemo(() => summarizeXrObjects(objectModels, sources), [objectModels, sources]);

  const loadDashboardData = React.useCallback(async () => {
    if (dashboardLoadInFlightRef.current) {
      return;
    }
    dashboardLoadInFlightRef.current = true;
    setLoading(true);
    try {
      const data = await fetchCopDashboardData(apiBase, labToken || undefined, {
        limit: 80,
        seconds: 900
      });
      setDashboardData(data);
      setLastLoadedAt(new Date().toLocaleTimeString("cs-CZ"));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Nepodařilo se načíst COP data pro XR režim.");
    } finally {
      dashboardLoadInFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!documentVisible) {
      return;
    }
    void loadDashboardData();
    const timer = window.setInterval(() => void loadDashboardData(), 8000);
    return () => window.clearInterval(timer);
  }, [documentVisible, loadDashboardData]);

  React.useEffect(() => {
    const xr = readNavigatorXr();
    if (!xr) {
      setXrSupport("unsupported");
      return;
    }
    xr.isSessionSupported("immersive-vr")
      .then((supported) => setXrSupport(supported ? "supported" : "unsupported"))
      .catch(() => setXrSupport("unsupported"));
  }, []);

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }
    const handles = createXrScene(mount, setSelectedObjectId);
    sceneRef.current = handles;
    renderXrMedia(handles, xrMedia);
    return () => {
      disposeXrScene(handles);
      sceneRef.current = null;
    };
  }, [xrMedia]);

  React.useEffect(() => {
    if (!sceneRef.current) {
      return;
    }
    renderXrObjects(sceneRef.current, objectModels, {
      selectedObjectId,
      showHistory: filters.showHistory,
      showPrediction: filters.showPrediction
    });
  }, [filters.showHistory, filters.showPrediction, objectModels, selectedObjectId]);

  React.useEffect(() => {
    if (!sceneRef.current) {
      return;
    }
    renderXrMap(sceneRef.current, objectModels);
  }, [objectModels]);

  React.useEffect(() => {
    if (!sceneRef.current) {
      return;
    }
    renderXrPanel(sceneRef.current, {
      filters,
      models: objectModels,
      selectedModel,
      summary
    });
  }, [filters, objectModels, selectedModel, summary]);

  async function startXrSession() {
    const xr = readNavigatorXr();
    const renderer = sceneRef.current?.renderer;
    if (!xr || !renderer) {
      setLoadError("WebXR runtime není v tomto prohlížeči dostupný.");
      return;
    }
    try {
      const session = await xr.requestSession("immersive-vr", {
        optionalFeatures: ["bounded-floor", "hand-tracking", "layers", "local-floor"]
      });
      session.addEventListener("end", () => setXrActive(false));
      await renderer.xr.setSession(session as unknown as XRSession);
      setXrActive(true);
      await playXrMedia(sceneRef.current);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Nepodařilo se spustit XR relaci.");
    }
  }

  return (
    <main className="xr-shell">
      <header className="xr-topbar">
        <a className="xr-back-link" href="/" aria-label="Zpět do mapy">
          <ArrowLeft size={18} />
          Mapa
        </a>
        <div>
          <span>CSM XR</span>
          <h1>Prostorová situační mapa</h1>
        </div>
        <div className="xr-topbar-actions">
          <button className="mini-button" type="button" onClick={() => void loadDashboardData()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Obnovit
          </button>
          <button
            className="primary-button xr-start-button"
            type="button"
            onClick={() => void startXrSession()}
            disabled={xrSupport !== "supported"}
          >
            <Sparkles size={16} />
            {xrActive
              ? "XR běží"
              : xrSupport === "checking"
                ? "Ověřuji XR"
                : xrSupport === "supported"
                  ? "Spustit v brýlích"
                  : "XR nedostupné"}
          </button>
        </div>
      </header>

      <section className="xr-layout">
        <aside className="xr-panel">
          <div className="xr-panel-section">
            <div className="xr-section-title">
              <Radar size={17} />
              Živý obraz
            </div>
            <div className="xr-metrics">
              <Metric label="Objekty" value={String(summary.visibleObjects)} />
              <Metric label="Lety" value={String(summary.publicFlights)} />
              <Metric label="Sim" value={String(summary.simulated)} />
              <Metric label="Zdroje" value={String(summary.activeSources)} />
            </div>
            <p className="xr-muted">Poslední načtení: {lastLoadedAt ?? "čekám na data"}</p>
            {loadError ? <div className="xr-error">{loadError}</div> : null}
          </div>

          <div className="xr-panel-section">
            <label className="search-field object-search-input">
              <Search size={15} />
              <input
                aria-label="Hledat v XR objektech"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="ID, callsign, typ, zdroj..."
              />
            </label>
          </div>

          {xrMedia ? (
            <div className="xr-panel-section">
              <div className="xr-section-title">
                <Play size={17} />
                3D video
              </div>
              <div className="xr-selected-card">
                <strong>{xrMedia.title}</strong>
                <span>{formatXrMediaLayout(xrMedia.layout)}</span>
                <small>
                  {xrMedia.layout === "apple_mv_hevc"
                    ? "Originál je zachovaný, WebXR používá 2D náhled bez konverze."
                    : "V brýlích se zobrazí oddělený obraz pro levé a pravé oko."}
                </small>
              </div>
              <button className="mini-button" type="button" onClick={() => void playXrMedia(sceneRef.current)}>
                <Play size={14} />
                Přehrát video
              </button>
            </div>
          ) : null}

          <div className="xr-panel-section">
            <div className="xr-section-title">
              <Layers size={17} />
              Vrstvy XR
            </div>
            <XrToggle
              label="Veřejné lety"
              checked={filters.showPublicFlights}
              onChange={(value) => setFilters((current) => ({ ...current, showPublicFlights: value }))}
            />
            <XrToggle
              label="Simulace"
              checked={filters.showSimulated}
              onChange={(value) => setFilters((current) => ({ ...current, showSimulated: value }))}
            />
            <XrToggle
              label="Ostatní tracky"
              checked={filters.showOtherTracks}
              onChange={(value) => setFilters((current) => ({ ...current, showOtherTracks: value }))}
            />
            <XrToggle
              label="Historie"
              checked={filters.showHistory}
              onChange={(value) => setFilters((current) => ({ ...current, showHistory: value }))}
            />
            <XrToggle
              label="Predikce"
              checked={filters.showPrediction}
              onChange={(value) => setFilters((current) => ({ ...current, showPrediction: value }))}
            />
          </div>

          <div className="xr-panel-section">
            <div className="xr-section-title">
              <Waypoints size={17} />
              Výběr objektu
            </div>
            {selectedModel ? (
              <div className="xr-selected-card">
                <strong>{selectedModel.label}</strong>
                <span>
                  {selectedModel.objectType} · {selectedModel.affiliation} · {selectedModel.status}
                </span>
                <small>
                  {selectedModel.confidence === undefined
                    ? "jistota není dostupná"
                    : `${Math.round(selectedModel.confidence * 100)} % jistota`}
                </small>
              </div>
            ) : (
              <div className="empty-mini">Vyberte marker ovladačem, rukou nebo kliknutím v náhledu.</div>
            )}
          </div>
        </aside>

        <section className="xr-stage">
          <div ref={mountRef} className="xr-canvas" aria-label="3D XR situační prostor" />
          <div className="xr-stage-overlay">
            <span>
              <Eye size={15} /> Desktop náhled: kliknutím vyberete objekt
            </span>
            <span>
              <Play size={15} /> Quest: oba trigery vybírají, grip posouvá mapu
            </span>
            <span>
              <History size={15} /> Páčky: pohyb, rotace, zoom, trigger + pravá páčka scroll
            </span>
            {xrMedia ? (
              <span>
                <Play size={15} /> Video: {formatXrMediaLayout(xrMedia.layout)}
              </span>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="xr-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function XrToggle({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row xr-toggle">
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      {label}
    </label>
  );
}

function createXrScene(mount: HTMLDivElement, selectObject: (objectId: string) => void): XrSceneHandles {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#071015");
  const camera = new THREE.PerspectiveCamera(52, mount.clientWidth / Math.max(mount.clientHeight, 1), 0.05, 120);
  camera.position.set(0, 2.6, 5.4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.shadowMap.enabled = false;
  mount.appendChild(renderer.domElement);

  const root = new THREE.Group();
  root.position.set(0, -1.08, -2.8);
  scene.add(root);
  const board = createBoard();
  root.add(board.group);
  root.add(createFloatingTitle());

  const markers = new THREE.Group();
  const labels = new THREE.Group();
  const paths = new THREE.Group();
  const panelParts = createXrInfoPanel();
  const media = new THREE.Group();
  media.position.set(0, 1.25, -4.1);
  root.add(paths, markers, labels, panelParts.panel);
  scene.add(media);

  scene.add(new THREE.HemisphereLight("#d7ecff", "#163126", 2.2));
  const keyLight = new THREE.DirectionalLight("#ffffff", 1.8);
  keyLight.position.set(4, 7, 4);
  scene.add(keyLight);

  const raycaster = new THREE.Raycaster();
  const input: XrInputState = {
    grabbedController: null,
    grabControllerStart: new THREE.Vector3(),
    grabRootStart: new THREE.Vector3(),
    panelMaxScroll: 0,
    panelScroll: 0,
    rootYaw: 0,
    zoom: 1
  };
  const handles: XrSceneHandles = {
    camera,
    controllers: [],
    input,
    interactive: [],
    labels,
    mapPlane: board.mapPlane,
    markers,
    media,
    panel: panelParts.panel,
    panelContent: panelParts.content,
    paths,
    raycaster,
    renderer,
    root,
    scene,
    selectObject
  };

  const resize = () => {
    const width = mount.clientWidth;
    const height = Math.max(mount.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  window.addEventListener("resize", resize);
  renderer.domElement.addEventListener("pointerdown", (event) => pickFromDesktopPointer(event, handles));

  for (const index of [0, 1]) {
    const controller = renderer.xr.getController(index);
    controller.add(createControllerRay(index));
    controller.addEventListener("selectstart", () => {
      setControllerRayActive(controller, true);
      pickFromController(controller, handles);
    });
    controller.addEventListener("selectend", () => setControllerRayActive(controller, false));
    controller.addEventListener("squeezestart", () => beginGripDrag(controller, handles));
    controller.addEventListener("squeezeend", () => endGripDrag(controller, handles));
    scene.add(controller);
    handles.controllers.push(controller);
  }

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const deltaSeconds = Math.min(clock.getDelta(), 0.05);
    applyXrInput(handles, deltaSeconds);
    if (!renderer.xr.isPresenting) {
      camera.lookAt(root.position.x, root.position.y, root.position.z);
    }
    syncXrStereoLayers(renderer, camera, media);
    renderer.render(scene, camera);
  });

  renderer.domElement.dataset.xrResizeListener = "active";
  Object.assign(handles, { resizeListener: resize });
  return handles;
}

function renderXrObjects(
  handles: XrSceneHandles,
  models: XrObjectModel[],
  options: { selectedObjectId: string | null; showHistory: boolean; showPrediction: boolean }
) {
  disposeGroupChildren(handles.markers);
  disposeGroupChildren(handles.labels);
  disposeGroupChildren(handles.paths);
  handles.interactive = [];

  models.forEach((model) => {
    const marker = createMarkerMesh(model);
    marker.position.set(model.position.x, model.position.y, model.position.z);
    tagInteractiveObject(marker, model.objectId);
    handles.markers.add(marker);
    marker.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        handles.interactive.push(object);
      }
    });

    if (model.objectId === options.selectedObjectId) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.025, 8, 48),
        new THREE.MeshBasicMaterial({ color: "#eaff9b" })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(model.position.x, Math.max(0.08, model.position.y - 0.05), model.position.z);
      handles.markers.add(ring);
    }

    if (handles.labels.children.length < 90) {
      const label = createLabelSprite(model.label, model.color);
      label.position.set(model.position.x, model.position.y + 0.42, model.position.z);
      handles.labels.add(label);
    }

    if (options.showHistory && model.history.length > 1) {
      handles.paths.add(createLinePath(model.history, "#8ab8ff", 0.45));
    }

    if (options.showPrediction && model.prediction) {
      handles.paths.add(createLinePath([model.position, model.prediction], "#c084fc", 0.85));
    }
  });
}

function renderXrPanel(
  handles: XrSceneHandles,
  options: {
    filters: XrFilters;
    models: XrObjectModel[];
    selectedModel: XrObjectModel | null;
    summary: ReturnType<typeof summarizeXrObjects>;
  }
) {
  disposeGroupChildren(handles.panelContent);
  const rows: Array<{ accent?: string; muted?: boolean; text: string }> = [
    { accent: "#c8f08d", text: "CSM XR LIVE" },
    {
      text: `${options.summary.visibleObjects} objektu | ${options.summary.publicFlights} verejnych letu | ${options.summary.simulated} simulaci`
    },
    {
      text: options.filters.showHistory ? "Historie: zapnuta" : "Historie: vypnuta",
      muted: !options.filters.showHistory
    },
    {
      text: options.filters.showPrediction ? "Predikce: zapnuta" : "Predikce: vypnuta",
      muted: !options.filters.showPrediction
    }
  ];
  if (options.selectedModel) {
    rows.push(
      { accent: options.selectedModel.color, text: "VYBRANY OBJEKT" },
      { text: options.selectedModel.label },
      {
        text: `${options.selectedModel.objectType} | ${options.selectedModel.affiliation} | ${options.selectedModel.status}`
      },
      { text: `${options.selectedModel.lat.toFixed(4)}, ${options.selectedModel.lon.toFixed(4)}` }
    );
  }
  rows.push({ accent: "#9dd6ff", text: "SEZNAM V XR" });
  options.models.slice(0, 28).forEach((model, index) => {
    rows.push({ accent: model.color, text: `${index + 1}. ${model.label.slice(0, 22)} | ${model.objectType}` });
  });

  rows.forEach((row, index) => {
    const sprite = createTextSprite(
      row.text,
      row.accent ?? (row.muted ? "#6b7280" : "#dbe5ee"),
      row.muted ? "rgba(8, 13, 18, 0.48)" : "rgba(8, 13, 18, 0.78)",
      768,
      112,
      "left"
    );
    sprite.position.set(0, -index * 0.25, 0.02);
    sprite.scale.set(1.92, 0.28, 1);
    handles.panelContent.add(sprite);
  });
  handles.input.panelMaxScroll = Math.max(0, rows.length * 0.25 - 2.8);
  handles.input.panelScroll = Math.min(handles.input.panelScroll, handles.input.panelMaxScroll);
  applyPanelScroll(handles);
}

function renderXrMap(handles: XrSceneHandles, models: XrObjectModel[]) {
  const mapSpec = createXrMapSpec(models);
  if (handles.root.userData.mapKey === mapSpec.key) {
    return;
  }
  handles.root.userData.mapKey = mapSpec.key;
  void buildXrMapCanvas(mapSpec)
    .then((canvas) => {
      if (handles.root.userData.mapKey !== mapSpec.key) {
        return;
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(handles.renderer.capabilities.getMaxAnisotropy(), 8);
      const previousMap = handles.mapPlane.material.map;
      handles.mapPlane.material.map = texture;
      handles.mapPlane.material.color.set("#ffffff");
      handles.mapPlane.material.needsUpdate = true;
      previousMap?.dispose();
    })
    .catch(() => {
      const canvas = createMapFallbackCanvas("Mapovy podklad neni dostupny");
      const texture = new THREE.CanvasTexture(canvas);
      const previousMap = handles.mapPlane.material.map;
      handles.mapPlane.material.map = texture;
      handles.mapPlane.material.color.set("#ffffff");
      handles.mapPlane.material.needsUpdate = true;
      previousMap?.dispose();
    });
}

function renderXrMedia(handles: XrSceneHandles, mediaParams: XrMediaParams | null) {
  clearXrMediaGroup(handles.media);
  if (!mediaParams) {
    return;
  }

  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = false;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = mediaParams.url;
  handles.media.userData.video = video;

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const aspect = 16 / 9;
  const width = 4.8;
  const height = width / aspect;
  const geometry = new THREE.PlaneGeometry(width, height);

  const monoPlane = new THREE.Mesh(geometry, createVideoMaterial(texture));
  monoPlane.userData.monoOnly = true;
  handles.media.add(monoPlane);

  if (mediaParams.layout === "side_by_side" || mediaParams.layout === "over_under") {
    const leftPlane = new THREE.Mesh(
      geometry.clone(),
      createVideoMaterial(createStereoVideoTexture(texture, mediaParams.layout, "left"))
    );
    const rightPlane = new THREE.Mesh(
      geometry.clone(),
      createVideoMaterial(createStereoVideoTexture(texture, mediaParams.layout, "right"))
    );
    leftPlane.layers.set(1);
    rightPlane.layers.set(2);
    leftPlane.userData.stereoOnly = true;
    rightPlane.userData.stereoOnly = true;
    leftPlane.visible = false;
    rightPlane.visible = false;
    handles.media.add(leftPlane, rightPlane);
  }

  const label = createTextSprite(formatXrMediaTitle(mediaParams), "#c8f08d", "rgba(4, 8, 12, 0.78)", 1024, 160);
  label.position.set(0, height / 2 + 0.42, 0.02);
  label.scale.set(3.2, 0.5, 1);
  handles.media.add(label);
}

async function playXrMedia(handles: XrSceneHandles | null) {
  const video = handles?.media.userData.video as HTMLVideoElement | undefined;
  if (!video) {
    return;
  }
  await video.play();
}

function clearXrMediaGroup(group: THREE.Group) {
  const video = group.userData.video as HTMLVideoElement | undefined;
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
    group.userData.video = undefined;
  }
  disposeGroupChildren(group);
}

function disposeXrScene(handles: XrSceneHandles) {
  const maybeResize = handles as XrSceneHandles & { resizeListener?: () => void };
  if (maybeResize.resizeListener) {
    window.removeEventListener("resize", maybeResize.resizeListener);
  }
  handles.renderer.setAnimationLoop(null);
  clearXrMediaGroup(handles.media);
  disposeGroupChildren(handles.scene);
  handles.renderer.dispose();
  handles.renderer.domElement.remove();
}

function createBoard(): { group: THREE.Group; mapPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> } {
  const board = new THREE.Group();
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(boardWidthM, boardDepthM),
    new THREE.MeshBasicMaterial({
      color: "#101d19",
      transparent: true,
      opacity: 0.96
    })
  );
  plane.rotation.x = -Math.PI / 2;
  board.add(plane);

  const grid = new THREE.GridHelper(boardWidthM, 16, "#c8f08d", "#2b4450");
  grid.scale.z = boardDepthM / boardWidthM;
  grid.position.y = 0.012;
  board.add(grid);

  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(boardWidthM, 0.04, boardDepthM)),
    new THREE.LineBasicMaterial({ color: "#c8f08d", transparent: true, opacity: 0.7 })
  );
  frame.position.y = 0.04;
  board.add(frame);
  return { group: board, mapPlane: plane };
}

function createXrInfoPanel(): { content: THREE.Group; panel: THREE.Group } {
  const panel = new THREE.Group();
  panel.position.set(boardWidthM / 2 + 1.95, 2.05, -1.3);
  panel.rotation.y = -0.28;
  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 3.25),
    new THREE.MeshBasicMaterial({
      color: "#071015",
      opacity: 0.88,
      transparent: true,
      side: THREE.DoubleSide
    })
  );
  backing.position.set(0, -1.2, 0);
  panel.add(backing);

  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2.22, 3.28, 0.02)),
    new THREE.LineBasicMaterial({ color: "#8cb6d8", transparent: true, opacity: 0.56 })
  );
  frame.position.copy(backing.position);
  panel.add(frame);

  const content = new THREE.Group();
  content.position.set(-0.02, 0.16, 0.01);
  panel.add(content);
  return { content, panel };
}

function createFloatingTitle(): THREE.Sprite {
  const sprite = createTextSprite("CSM XR - prostorovy COP", "#c8f08d", "#102016", 1024, 180);
  sprite.position.set(0, 2.2, -4.3);
  sprite.scale.set(4.8, 0.84, 1);
  return sprite;
}

function createControllerRay(index: number): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -6)]);
  const material = new THREE.LineBasicMaterial({
    color: index === 0 ? "#9dd6ff" : "#c8f08d",
    transparent: true,
    opacity: 0.74
  });
  return new THREE.Line(geometry, material);
}

function createMarkerMesh(model: XrObjectModel): THREE.Object3D {
  const color = new THREE.Color(model.color);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: model.isPublicFlight ? 0.32 : 0.18,
    roughness: 0.42
  });
  if (model.isPublicFlight) {
    return createCivilAircraftMarker(model, material);
  }
  if (model.domain === "AIR") {
    return createStandardAirMarker(model, material);
  }
  return new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 12), material);
}

function createCivilAircraftMarker(model: XrObjectModel, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.58), material);
  const wings = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.045, 0.14), material);
  wings.position.z = -0.03;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.08), material);
  tail.position.z = 0.23;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.16, 16), material);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -0.37;
  group.add(fuselage, wings, tail, nose);
  group.rotation.y = THREE.MathUtils.degToRad(model.headingDeg ?? 0);
  return group;
}

function createStandardAirMarker(model: XrObjectModel, material: THREE.Material): THREE.Object3D {
  if (model.affiliation === "FRIEND" || model.affiliation === "ASSUMED_FRIEND") {
    const group = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), material);
    dome.scale.z = 1.18;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.055, 0.16), material);
    base.position.y = -0.02;
    group.add(dome, base);
    return group;
  }
  if (model.affiliation === "HOSTILE" || model.affiliation === "SUSPECT") {
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), material);
    mesh.rotation.y = Math.PI / 4;
    return mesh;
  }
  if (model.affiliation === "UNKNOWN") {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 10, 32), material);
    ring.rotation.x = Math.PI / 2;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), material);
    group.add(ring, dot);
    return group;
  }
  return new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), material);
}

function createLabelSprite(text: string, color: string): THREE.Sprite {
  const sprite = createTextSprite(text.slice(0, 22), color, "rgba(4, 8, 12, 0.72)", 512, 128);
  sprite.scale.set(1.35, 0.34, 1);
  return sprite;
}

function createTextSprite(
  text: string,
  foreground: string,
  background: string,
  width: number,
  height: number,
  align: CanvasTextAlign = "center"
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = foreground;
    context.lineWidth = 6;
    context.strokeRect(4, 4, width - 8, height - 8);
    context.fillStyle = "#f4f7fb";
    context.font = "800 46px system-ui, -apple-system, Segoe UI, sans-serif";
    context.textAlign = align;
    context.textBaseline = "middle";
    context.fillText(text, align === "left" ? 36 : width / 2, height / 2 + 4, width - 56);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
}

function createLinePath(
  points: Array<{ x: number; y: number; z: number }>,
  color: string,
  opacity: number
): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map((point) => new THREE.Vector3(point.x, point.y, point.z))
  );
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.Line(geometry, material);
}

function createVideoMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    toneMapped: false
  });
}

function createStereoVideoTexture(
  baseTexture: THREE.VideoTexture,
  layout: "over_under" | "side_by_side",
  eye: "left" | "right"
): THREE.Texture {
  const texture = baseTexture.clone();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  if (layout === "side_by_side") {
    texture.repeat.set(0.5, 1);
    texture.offset.set(eye === "left" ? 0 : 0.5, 0);
  } else {
    texture.repeat.set(1, 0.5);
    texture.offset.set(0, eye === "left" ? 0.5 : 0);
  }
  texture.needsUpdate = true;
  return texture;
}

function syncXrStereoLayers(renderer: THREE.WebGLRenderer, _camera: THREE.PerspectiveCamera, media: THREE.Group) {
  const presenting = renderer.xr.isPresenting;
  media.traverse((object) => {
    if (object.userData.monoOnly) {
      object.visible = !presenting;
    }
    if (object.userData.stereoOnly) {
      object.visible = presenting;
    }
  });
  if (!presenting) {
    return;
  }
  const xrCamera = renderer.xr.getCamera() as THREE.ArrayCamera & { cameras?: THREE.Camera[] };
  xrCamera.cameras?.[0]?.layers.enable(1);
  xrCamera.cameras?.[1]?.layers.enable(2);
}

function formatXrMediaTitle(media: XrMediaParams): string {
  return `${media.title.slice(0, 34)} - ${formatXrMediaLayout(media.layout)}`;
}

function formatXrMediaLayout(layout: XrMediaLayout): string {
  switch (layout) {
    case "side_by_side":
      return "3D side-by-side";
    case "over_under":
      return "3D over-under";
    case "apple_mv_hevc":
      return "iPhone Spatial MOV - 2D WebXR fallback";
    default:
      return "2D video";
  }
}

function pickFromDesktopPointer(event: PointerEvent, handles: XrSceneHandles) {
  const rect = handles.renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1)
  );
  handles.raycaster.setFromCamera(pointer, handles.camera);
  pickFromRay(handles);
}

function pickFromController(controller: THREE.Group, handles: XrSceneHandles) {
  const tempMatrix = new THREE.Matrix4();
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  handles.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  handles.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  pickFromRay(handles);
}

function pickFromRay(handles: XrSceneHandles) {
  const hit = handles.raycaster.intersectObjects(handles.interactive, false)[0];
  const objectId = hit ? readObjectIdFromHit(hit.object) : undefined;
  if (objectId) {
    handles.selectObject(objectId);
  }
}

function readObjectIdFromHit(object: THREE.Object3D | null): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.objectId === "string") {
      return current.userData.objectId;
    }
    current = current.parent;
  }
  return undefined;
}

function tagInteractiveObject(object: THREE.Object3D, objectId: string) {
  object.userData.objectId = objectId;
  object.traverse((child) => {
    child.userData.objectId = objectId;
  });
}

function setControllerRayActive(controller: THREE.Group, active: boolean) {
  const ray = controller.children.find((child): child is THREE.Line => child.type === "Line");
  const material = ray?.material as THREE.LineBasicMaterial | undefined;
  if (material) {
    material.opacity = active ? 1 : 0.74;
  }
}

function beginGripDrag(controller: THREE.Group, handles: XrSceneHandles) {
  handles.input.grabbedController = controller;
  handles.input.grabControllerStart.setFromMatrixPosition(controller.matrixWorld);
  handles.input.grabRootStart.copy(handles.root.position);
}

function endGripDrag(controller: THREE.Group, handles: XrSceneHandles) {
  if (handles.input.grabbedController === controller) {
    handles.input.grabbedController = null;
  }
}

function applyXrInput(handles: XrSceneHandles, deltaSeconds: number) {
  updateGripDrag(handles);
  const session = handles.renderer.xr.getSession();
  if (!session) {
    return;
  }
  let handednessIndex = 0;
  for (const source of session.inputSources) {
    const gamepad = source.gamepad;
    if (!gamepad) {
      continue;
    }
    const axes = readXrStickAxes(gamepad);
    const side =
      source.handedness === "left" || (source.handedness === "none" && handednessIndex === 0) ? "left" : "right";
    handednessIndex += 1;
    if (side === "left") {
      panXrRoot(handles, axes.x, axes.y, deltaSeconds);
    } else {
      const triggerPressed = isXrTriggerPressed(gamepad);
      if (triggerPressed) {
        scrollXrPanel(handles, axes.y, deltaSeconds);
      } else {
        rotateAndZoomXrRoot(handles, axes.x, axes.y, deltaSeconds);
      }
    }
  }
}

function updateGripDrag(handles: XrSceneHandles) {
  const controller = handles.input.grabbedController;
  if (!controller) {
    return;
  }
  const current = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
  const delta = current.sub(handles.input.grabControllerStart);
  handles.root.position.copy(handles.input.grabRootStart).add(delta);
  handles.root.position.x = clampNumber(handles.root.position.x, -5.5, 5.5);
  handles.root.position.y = clampNumber(handles.root.position.y, -2.4, 1.2);
  handles.root.position.z = clampNumber(handles.root.position.z, -8.5, -1.2);
}

function panXrRoot(handles: XrSceneHandles, xAxis: number, yAxis: number, deltaSeconds: number) {
  const speed = 2.3 / handles.input.zoom;
  const forward = new THREE.Vector3(Math.sin(handles.input.rootYaw), 0, Math.cos(handles.input.rootYaw));
  const right = new THREE.Vector3(Math.cos(handles.input.rootYaw), 0, -Math.sin(handles.input.rootYaw));
  handles.root.position.addScaledVector(right, xAxis * speed * deltaSeconds);
  handles.root.position.addScaledVector(forward, yAxis * speed * deltaSeconds);
  handles.root.position.x = clampNumber(handles.root.position.x, -5.5, 5.5);
  handles.root.position.z = clampNumber(handles.root.position.z, -8.5, -1.2);
}

function rotateAndZoomXrRoot(handles: XrSceneHandles, xAxis: number, yAxis: number, deltaSeconds: number) {
  handles.input.rootYaw += xAxis * deltaSeconds * 1.15;
  handles.input.zoom = clampNumber(handles.input.zoom + -yAxis * deltaSeconds * 0.8, 0.46, 2.2);
  handles.root.rotation.y = handles.input.rootYaw;
  handles.root.scale.setScalar(handles.input.zoom);
}

function scrollXrPanel(handles: XrSceneHandles, yAxis: number, deltaSeconds: number) {
  handles.input.panelScroll = clampNumber(
    handles.input.panelScroll + yAxis * deltaSeconds * 2.6,
    0,
    handles.input.panelMaxScroll
  );
  applyPanelScroll(handles);
}

function applyPanelScroll(handles: XrSceneHandles) {
  handles.panelContent.position.y = 0.16 + handles.input.panelScroll;
}

function readXrStickAxes(gamepad: Gamepad): { x: number; y: number } {
  const offset = gamepad.axes.length >= 4 ? gamepad.axes.length - 2 : 0;
  return {
    x: deadzone(gamepad.axes[offset] ?? 0),
    y: deadzone(gamepad.axes[offset + 1] ?? 0)
  };
}

function isXrTriggerPressed(gamepad: Gamepad): boolean {
  return Boolean(gamepad.buttons[0]?.pressed || (gamepad.buttons[0]?.value ?? 0) > 0.35);
}

function deadzone(value: number): number {
  return Math.abs(value) < 0.16 ? 0 : value;
}

function disposeGroupChildren(group: THREE.Object3D) {
  for (const child of [...group.children]) {
    disposeGroupChildren(child);
    group.remove(child);
    const maybeMesh = child as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    maybeMesh.geometry?.dispose();
    if (Array.isArray(maybeMesh.material)) {
      maybeMesh.material.forEach(disposeMaterial);
    } else {
      disposeMaterial(maybeMesh.material);
    }
  }
}

function disposeMaterial(material: THREE.Material | undefined) {
  if (!material) {
    return;
  }
  const materialWithMap = material as THREE.Material & { map?: THREE.Texture };
  materialWithMap.map?.dispose();
  material.dispose();
}

function selectXrPreferredObjects(objects: CopObject[], preferences: UserPreferences): CopObject[] {
  const visible = filterVisibleObjects(objects, {
    includeSynthetic: preferences.includeSynthetic ?? true,
    minConfidence: preferences.minConfidence ?? 0
  });
  const layers = normalizeXrTrackLayers(preferences);
  if (layers.length === 0) {
    return visible;
  }
  const layered = filterObjectsByLayers(visible, layers);
  return layered.length > 0 ? layered : visible;
}

function normalizeXrTrackLayers(preferences: UserPreferences): CopLayer[] {
  const explicit = preferences.trackLayerIds?.filter(isCopLayer) ?? [];
  if (explicit.length > 0) {
    return explicit;
  }
  return preferences.selectedLayer && isCopLayer(preferences.selectedLayer) ? [preferences.selectedLayer] : copLayerIds;
}

function isCopLayer(value: string): value is CopLayer {
  return copLayerIds.includes(value as CopLayer);
}

function filterXrObjects(objects: CopObject[], filters: XrFilters, searchQuery: string): CopObject[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  return objects.filter((object) => {
    const publicFlight = isPublicFlightObject(object);
    const simulated = isSimulatedObject(object);
    if (publicFlight && !filters.showPublicFlights) {
      return false;
    }
    if (simulated && !filters.showSimulated) {
      return false;
    }
    if (!publicFlight && !simulated && !filters.showOtherTracks) {
      return false;
    }
    if (!object.position) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [
      object.objectId,
      formatXrObjectLabel(object),
      object.objectType,
      object.affiliation,
      object.domain,
      object.status,
      object.attributes?.provenance?.sourceSystemId
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

interface XrMapSpec {
  centerTileX: number;
  centerTileY: number;
  key: string;
  zoom: number;
}

function createXrMapSpec(models: XrObjectModel[]): XrMapSpec {
  const finiteModels = models.filter((model) => Number.isFinite(model.lat) && Number.isFinite(model.lon));
  const lats = finiteModels.map((model) => model.lat);
  const lons = finiteModels.map((model) => model.lon);
  const centerLat = average(lats) ?? 50.08;
  const centerLon = average(lons) ?? 14.42;
  const latSpan = lats.length > 1 ? Math.max(...lats) - Math.min(...lats) : 0.08;
  const lonSpan = lons.length > 1 ? Math.max(...lons) - Math.min(...lons) : 0.08;
  const span = Math.max(latSpan, lonSpan);
  const zoom = span < 0.04 ? 13 : span < 0.12 ? 12 : span < 0.32 ? 11 : span < 0.8 ? 10 : span < 1.8 ? 8 : 6;
  const centerTile = lonLatToTile(centerLon, centerLat, zoom);
  return {
    centerTileX: centerTile.x,
    centerTileY: centerTile.y,
    key: `${zoom}:${Math.floor(centerTile.x * 10)}:${Math.floor(centerTile.y * 10)}:${models.length}`,
    zoom
  };
}

async function buildXrMapCanvas(spec: XrMapSpec): Promise<HTMLCanvasElement> {
  const tileSize = 256;
  const tileColumns = 5;
  const tileRows = 3;
  const canvas = document.createElement("canvas");
  canvas.width = tileColumns * tileSize;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }
  context.fillStyle = "#102016";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const startX = Math.floor(spec.centerTileX) - Math.floor(tileColumns / 2);
  const startY = Math.floor(spec.centerTileY) - Math.floor(tileRows / 2);
  const verticalCrop = (tileRows * tileSize - canvas.height) / 2;
  await Promise.all(
    Array.from({ length: tileColumns * tileRows }, async (_, index) => {
      const xIndex = index % tileColumns;
      const yIndex = Math.floor(index / tileColumns);
      const tileX = normalizeTileX(startX + xIndex, spec.zoom);
      const tileY = startY + yIndex;
      const maxTile = 2 ** spec.zoom;
      if (tileY < 0 || tileY >= maxTile) {
        return;
      }
      try {
        const image = await loadTileImage(tileUrlFor(spec.zoom, tileX, tileY));
        context.drawImage(image, xIndex * tileSize, yIndex * tileSize - verticalCrop, tileSize, tileSize);
      } catch {
        drawMissingMapTile(context, xIndex * tileSize, yIndex * tileSize - verticalCrop, tileSize);
      }
    })
  );
  context.fillStyle = "rgba(5, 9, 12, 0.66)";
  context.fillRect(0, canvas.height - 42, canvas.width, 42);
  context.fillStyle = "#dbe5ee";
  context.font = "700 22px system-ui, -apple-system, Segoe UI, sans-serif";
  context.fillText("© OpenStreetMap contributors | CSM XR map cache", 24, canvas.height - 15);
  return canvas;
}

function drawMissingMapTile(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  context.fillStyle = "#102016";
  context.fillRect(x, y, size, size);
  context.strokeStyle = "rgba(200, 240, 141, 0.28)";
  context.strokeRect(x + 1, y + 1, size - 2, size - 2);
}

function createMapFallbackCanvas(message: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#101d19";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#c8f08d";
    context.lineWidth = 4;
    for (let x = 0; x < canvas.width; x += 160) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y < canvas.height; y += 120) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
    context.fillStyle = "#f4f7fb";
    context.font = "900 48px system-ui, -apple-system, Segoe UI, sans-serif";
    context.textAlign = "center";
    context.fillText(message, canvas.width / 2, canvas.height / 2);
  }
  return canvas;
}

function tileUrlFor(z: number, x: number, y: number): string {
  return xrTileUrlTemplate.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

function loadTileImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Map tile failed: ${url}`));
    image.src = url;
  });
}

function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const latRad = THREE.MathUtils.degToRad(clampNumber(lat, -85.0511, 85.0511));
  const scale = 2 ** zoom;
  return {
    x: ((lon + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  };
}

function normalizeTileX(x: number, zoom: number): number {
  const scale = 2 ** zoom;
  return ((x % scale) + scale) % scale;
}

function average(values: number[]): number | undefined {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readXrMediaParams(): XrMediaParams | null {
  const params = new URLSearchParams(window.location.search);
  const rawUrl = params.get("media")?.trim();
  if (!rawUrl) {
    return null;
  }
  const url = normalizeXrMediaUrl(rawUrl);
  if (!url) {
    return null;
  }
  const rawLayout = params.get("layout")?.trim();
  const layout: XrMediaLayout =
    rawLayout === "apple_mv_hevc" || rawLayout === "over_under" || rawLayout === "side_by_side" ? rawLayout : "mono";
  return {
    layout,
    title: params.get("title")?.trim().slice(0, 80) || "Komunitní video",
    url
  };
}

function normalizeXrMediaUrl(rawUrl: string): string | null {
  try {
    const resolved = new URL(rawUrl, window.location.origin);
    if (resolved.protocol !== "https:" && resolved.protocol !== "http:") {
      return null;
    }
    return resolved.origin === window.location.origin
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : resolved.toString();
  } catch {
    return null;
  }
}

function readNavigatorXr():
  | undefined
  | {
      isSessionSupported: (mode: string) => Promise<boolean>;
      requestSession: (
        mode: string,
        options?: unknown
      ) => Promise<{
        addEventListener: (name: "end", listener: () => void) => void;
      }>;
    } {
  return (
    navigator as Navigator & {
      xr?: {
        isSessionSupported: (mode: string) => Promise<boolean>;
        requestSession: (
          mode: string,
          options?: unknown
        ) => Promise<{
          addEventListener: (name: "end", listener: () => void) => void;
        }>;
      };
    }
  ).xr;
}
