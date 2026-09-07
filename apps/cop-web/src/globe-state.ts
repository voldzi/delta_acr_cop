import type { CopObject, ServerTrackHistoryPoint } from "./cop-data";

const earthRadiusM = 6_371_008.8;
const maxEstimateAgeMs = 20_000;

export interface GlobeCameraState {
  heading: number;
  height: number;
  lat: number;
  lon: number;
  pitch: number;
  roll: number;
}

export interface GlobeShareState {
  camera: GlobeCameraState;
  history: boolean;
  predictions: boolean;
  selectedObjectId?: string;
  version: 1;
}

export interface GlobeTrackPosition {
  ageMs: number;
  altitudeM: number;
  lat: number;
  lon: number;
  state: "estimated" | "observed" | "stale";
}

export function projectedGlobePosition(object: CopObject, nowMs = Date.now()): GlobeTrackPosition | null {
  const position = object.position;
  if (!position || !validCoordinate(position.lon, position.lat)) return null;

  const observedAtMs = Date.parse(object.lastUpdatedAt ?? "");
  const ageMs = Number.isFinite(observedAtMs) ? Math.max(0, nowMs - observedAtMs) : 0;
  const speedMps = object.movement?.speedMps ?? object.speedMps;
  const headingDeg = object.movement?.headingDeg ?? object.headingDeg;
  const canEstimate =
    ageMs > 750 &&
    ageMs <= maxEstimateAgeMs &&
    typeof speedMps === "number" &&
    Number.isFinite(speedMps) &&
    speedMps > 0.5 &&
    typeof headingDeg === "number" &&
    Number.isFinite(headingDeg);

  if (!canEstimate) {
    return {
      ageMs,
      altitudeM: finiteNumber(position.altitudeM) ?? 0,
      lat: position.lat,
      lon: position.lon,
      state: ageMs > maxEstimateAgeMs ? "stale" : "observed"
    };
  }

  const distanceM = Math.min(speedMps * (ageMs / 1000), speedMps * (maxEstimateAgeMs / 1000));
  const bearing = degreesToRadians(headingDeg);
  const lat1 = degreesToRadians(position.lat);
  const lon1 = degreesToRadians(position.lon);
  const angularDistance = distanceM / earthRadiusM;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );
  const verticalRate = finiteNumber(object.movement?.verticalRateMps ?? object.verticalRateMps) ?? 0;

  return {
    ageMs,
    altitudeM: Math.max(0, (finiteNumber(position.altitudeM) ?? 0) + verticalRate * (ageMs / 1000)),
    lat: radiansToDegrees(lat2),
    lon: normalizeLongitude(radiansToDegrees(lon2)),
    state: "estimated"
  };
}

export function globeHistoryCoordinates(points: ServerTrackHistoryPoint[], limit = 48): number[] {
  return points
    .filter((point) => validCoordinate(point.lon, point.lat))
    .slice(-Math.max(2, limit))
    .flatMap((point) => [point.lon, point.lat, 0]);
}

export function encodeGlobeShareState(state: GlobeShareState): string {
  const params = new URLSearchParams({
    h: state.camera.height.toFixed(0),
    hd: state.camera.heading.toFixed(4),
    lat: state.camera.lat.toFixed(6),
    lon: state.camera.lon.toFixed(6),
    p: state.camera.pitch.toFixed(4),
    r: state.camera.roll.toFixed(4),
    v: "1"
  });
  if (state.history) params.set("history", "1");
  if (state.predictions) params.set("predictions", "1");
  if (state.selectedObjectId) params.set("selected", state.selectedObjectId.slice(0, 160));
  return params.toString();
}

export function decodeGlobeShareState(hash: string): GlobeShareState | null {
  const params = new URLSearchParams(hash.replace(/^#/u, ""));
  if (params.get("v") !== "1") return null;
  const camera = {
    heading: finiteParam(params, "hd"),
    height: finiteParam(params, "h"),
    lat: finiteParam(params, "lat"),
    lon: finiteParam(params, "lon"),
    pitch: finiteParam(params, "p"),
    roll: finiteParam(params, "r")
  };
  if (
    Object.values(camera).some((value) => value === null) ||
    !validCoordinate(camera.lon ?? Number.NaN, camera.lat ?? Number.NaN) ||
    (camera.height ?? 0) < 50 ||
    (camera.height ?? 0) > 25_000_000 ||
    Math.abs(camera.pitch ?? 0) > Math.PI ||
    Math.abs(camera.roll ?? 0) > Math.PI * 2 ||
    Math.abs(camera.heading ?? 0) > Math.PI * 2
  ) {
    return null;
  }
  const selected = params.get("selected")?.trim();
  return {
    camera: camera as GlobeCameraState,
    history: params.get("history") === "1",
    predictions: params.get("predictions") === "1",
    ...(selected && selected.length <= 160 ? { selectedObjectId: selected } : {}),
    version: 1
  };
}

export function assessGlobeCapability(input: {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  reducedMotion?: boolean;
  saveData?: boolean;
  webgl2?: boolean;
}): { mode: "balanced" | "limited" | "unsupported"; reasons: string[] } {
  if (input.webgl2 === false) {
    return { mode: "unsupported", reasons: ["Pro 3D pohled je potřeba WebGL 2."] };
  }
  const reasons: string[] = [];
  if (input.saveData) reasons.push("Prohlížeč má zapnuté šetření dat.");
  if (input.reducedMotion) reasons.push("Zařízení požaduje omezení pohybu.");
  if (input.deviceMemory !== undefined && input.deviceMemory < 4) reasons.push("Zařízení má omezenou paměť.");
  if (input.hardwareConcurrency !== undefined && input.hardwareConcurrency < 4)
    reasons.push("Zařízení má omezený počet výpočetních jader.");
  return { mode: reasons.length > 0 ? "limited" : "balanced", reasons };
}

function finiteParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function finiteNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validCoordinate(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

function normalizeLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}
