import React from "react";
import * as THREE from "three";
import { ArrowLeft, Eye, History, Layers, Play, Radar, RefreshCw, Search, Sparkles, Waypoints } from "lucide-react";
import {
  fetchCopDashboardData,
  isPublicFlightObject,
  type CopDashboardData,
  type CopObject
} from "./cop-data";
import { buildXrObjectModels, formatXrObjectLabel, isSimulatedObject, summarizeXrObjects, type XrObjectModel } from "./xr-model";
import "./styles.css";

const apiBase = import.meta.env.VITE_COP_API_BASE_URL ?? "";
const labToken = import.meta.env.VITE_COP_PUBLIC_LAB_VALUE ?? (import.meta.env.DEV ? "dev-lab-token" : "");
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
  interactive: THREE.Object3D[];
  labels: THREE.Group;
  markers: THREE.Group;
  media: THREE.Group;
  paths: THREE.Group;
  raycaster: THREE.Raycaster;
  renderer: THREE.WebGLRenderer;
  root: THREE.Group;
  scene: THREE.Scene;
  selectObject: (objectId: string) => void;
}

type XrSupportState = "checking" | "supported" | "unsupported";

export default function XrWorkspace() {
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const sceneRef = React.useRef<XrSceneHandles | null>(null);
  const [dashboardData, setDashboardData] = React.useState<CopDashboardData | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [lastLoadedAt, setLastLoadedAt] = React.useState<string | null>(null);
  const [xrSupport, setXrSupport] = React.useState<XrSupportState>("checking");
  const [xrActive, setXrActive] = React.useState(false);
  const [selectedObjectId, setSelectedObjectId] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filters, setFilters] = React.useState<XrFilters>({
    showHistory: true,
    showOtherTracks: true,
    showPrediction: true,
    showPublicFlights: true,
    showSimulated: true
  });
  const xrMedia = React.useMemo(() => readXrMediaParams(), []);

  const objects = dashboardData?.objects ?? [];
  const sources = dashboardData?.sources ?? [];
  const trackHistory = dashboardData?.trackHistory ?? {};
  const filteredObjects = React.useMemo(
    () => filterXrObjects(objects, filters, searchQuery),
    [filters, objects, searchQuery]
  );
  const objectModels = React.useMemo(
    () => buildXrObjectModels(filteredObjects, trackHistory, { maxObjects: maxXrObjects }),
    [filteredObjects, trackHistory]
  );
  const selectedModel = objectModels.find((model) => model.objectId === selectedObjectId) ?? objectModels[0] ?? null;
  const summary = React.useMemo(() => summarizeXrObjects(objectModels, sources), [objectModels, sources]);

  const loadDashboardData = React.useCallback(async () => {
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
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDashboardData();
    const timer = window.setInterval(() => void loadDashboardData(), 8000);
    return () => window.clearInterval(timer);
  }, [loadDashboardData]);

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
          <button className="primary-button xr-start-button" type="button" onClick={() => void startXrSession()} disabled={xrSupport !== "supported"}>
            <Sparkles size={16} />
            {xrActive ? "XR běží" : xrSupport === "checking" ? "Ověřuji XR" : xrSupport === "supported" ? "Spustit v brýlích" : "XR nedostupné"}
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
                <small>{xrMedia.layout === "apple_mv_hevc" ? "Originál je zachovaný, WebXR používá 2D náhled bez konverze." : "V brýlích se zobrazí oddělený obraz pro levé a pravé oko."}</small>
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
            <XrToggle label="Veřejné lety" checked={filters.showPublicFlights} onChange={(value) => setFilters((current) => ({ ...current, showPublicFlights: value }))} />
            <XrToggle label="Simulace" checked={filters.showSimulated} onChange={(value) => setFilters((current) => ({ ...current, showSimulated: value }))} />
            <XrToggle label="Ostatní tracky" checked={filters.showOtherTracks} onChange={(value) => setFilters((current) => ({ ...current, showOtherTracks: value }))} />
            <XrToggle label="Historie" checked={filters.showHistory} onChange={(value) => setFilters((current) => ({ ...current, showHistory: value }))} />
            <XrToggle label="Predikce" checked={filters.showPrediction} onChange={(value) => setFilters((current) => ({ ...current, showPrediction: value }))} />
          </div>

          <div className="xr-panel-section">
            <div className="xr-section-title">
              <Waypoints size={17} />
              Výběr objektu
            </div>
            {selectedModel ? (
              <div className="xr-selected-card">
                <strong>{selectedModel.label}</strong>
                <span>{selectedModel.objectType} · {selectedModel.affiliation} · {selectedModel.status}</span>
                <small>{selectedModel.confidence === undefined ? "confidence n/a" : `${Math.round(selectedModel.confidence * 100)} % confidence`}</small>
              </div>
            ) : (
              <div className="empty-mini">Vyberte marker ovladačem, rukou nebo kliknutím v náhledu.</div>
            )}
          </div>
        </aside>

        <section className="xr-stage">
          <div ref={mountRef} className="xr-canvas" aria-label="3D XR situační prostor" />
          <div className="xr-stage-overlay">
            <span><Eye size={15} /> Desktop náhled: kliknutím vyberete objekt</span>
            <span><Play size={15} /> Quest: tlačítko Spustit v brýlích</span>
            <span><History size={15} /> Historie a predikce jsou prostorové vrstvy</span>
            {xrMedia ? <span><Play size={15} /> Video: {formatXrMediaLayout(xrMedia.layout)}</span> : null}
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

function XrToggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
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
  root.add(createBoard());
  root.add(createFloatingTitle());

  const markers = new THREE.Group();
  const labels = new THREE.Group();
  const paths = new THREE.Group();
  const media = new THREE.Group();
  media.position.set(0, 1.25, -4.1);
  root.add(paths, markers, labels);
  scene.add(media);

  scene.add(new THREE.HemisphereLight("#d7ecff", "#163126", 2.2));
  const keyLight = new THREE.DirectionalLight("#ffffff", 1.8);
  keyLight.position.set(4, 7, 4);
  scene.add(keyLight);

  const raycaster = new THREE.Raycaster();
  const handles: XrSceneHandles = {
    camera,
    controllers: [],
    interactive: [],
    labels,
    markers,
    media,
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
    controller.add(createControllerRay());
    controller.addEventListener("select", () => pickFromController(controller, handles));
    scene.add(controller);
    handles.controllers.push(controller);
  }

  renderer.setAnimationLoop(() => {
    camera.lookAt(root.position.x, root.position.y, root.position.z);
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
    marker.userData.objectId = model.objectId;
    handles.markers.add(marker);
    handles.interactive.push(marker);

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
    const leftPlane = new THREE.Mesh(geometry.clone(), createVideoMaterial(createStereoVideoTexture(texture, mediaParams.layout, "left")));
    const rightPlane = new THREE.Mesh(geometry.clone(), createVideoMaterial(createStereoVideoTexture(texture, mediaParams.layout, "right")));
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

function createBoard(): THREE.Group {
  const board = new THREE.Group();
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(boardWidthM, boardDepthM),
    new THREE.MeshStandardMaterial({
      color: "#101d19",
      emissive: "#13281e",
      emissiveIntensity: 0.38,
      metalness: 0.05,
      roughness: 0.86,
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
  return board;
}

function createFloatingTitle(): THREE.Sprite {
  const sprite = createTextSprite("CSM XR - prostorovy COP", "#c8f08d", "#102016", 1024, 180);
  sprite.position.set(0, 2.2, -4.3);
  sprite.scale.set(4.8, 0.84, 1);
  return sprite;
}

function createControllerRay(): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -6)]);
  const material = new THREE.LineBasicMaterial({ color: "#c8f08d", transparent: true, opacity: 0.8 });
  return new THREE.Line(geometry, material);
}

function createMarkerMesh(model: XrObjectModel): THREE.Mesh {
  const color = new THREE.Color(model.color);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: model.isPublicFlight ? 0.32 : 0.18,
    roughness: 0.42
  });
  if (model.isPublicFlight) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.46, 4), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = THREE.MathUtils.degToRad(-(model.headingDeg ?? 0));
    return mesh;
  }
  if (model.domain === "AIR") {
    return new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), material);
  }
  return new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 12), material);
}

function createLabelSprite(text: string, color: string): THREE.Sprite {
  const sprite = createTextSprite(text.slice(0, 22), color, "rgba(4, 8, 12, 0.72)", 512, 128);
  sprite.scale.set(1.35, 0.34, 1);
  return sprite;
}

function createTextSprite(text: string, foreground: string, background: string, width: number, height: number): THREE.Sprite {
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
    context.font = "800 48px system-ui, -apple-system, Segoe UI, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, width / 2, height / 2 + 4, width - 40);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
}

function createLinePath(points: Array<{ x: number; y: number; z: number }>, color: string, opacity: number): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, point.y, point.z)));
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

function createStereoVideoTexture(baseTexture: THREE.VideoTexture, layout: "over_under" | "side_by_side", eye: "left" | "right"): THREE.Texture {
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
  const objectId = typeof hit?.object.userData.objectId === "string" ? hit.object.userData.objectId : undefined;
  if (objectId) {
    handles.selectObject(objectId);
  }
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
    ].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery);
  });
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
    return resolved.origin === window.location.origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` : resolved.toString();
  } catch {
    return null;
  }
}

function readNavigatorXr():
  | undefined
  | {
    isSessionSupported: (mode: string) => Promise<boolean>;
    requestSession: (mode: string, options?: unknown) => Promise<{
      addEventListener: (name: "end", listener: () => void) => void;
    }>;
  } {
  return (navigator as Navigator & {
    xr?: {
      isSessionSupported: (mode: string) => Promise<boolean>;
      requestSession: (mode: string, options?: unknown) => Promise<{
        addEventListener: (name: "end", listener: () => void) => void;
      }>;
    };
  }).xr;
}
