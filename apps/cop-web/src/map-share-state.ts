import type { MapBasemapMode, MapViewState } from "./user-preferences";

const maxLayerIds = 40;
const maxSelectedIdLength = 160;

export interface CopMapShareState {
  basemap: MapBasemapMode;
  camera: MapViewState;
  catalogLayerIds: string[];
  safetyLayerIds: string[];
  selectedObjectId?: string;
  situationLayerIds: string[];
  trackLayerIds: string[];
  version: 1;
  workspace: "alerts" | "data" | "map";
}

const keys = {
  basemap: "sbase",
  bearing: "sbr",
  catalog: "scat",
  lat: "slat",
  lon: "slon",
  pitch: "spi",
  safety: "ssafe",
  selected: "ssel",
  situation: "ssit",
  tracks: "strk",
  version: "sv",
  workspace: "sws",
  zoom: "sz"
} as const;

export function buildCopMapShareUrl(href: string, state: CopMapShareState): string {
  const url = new URL(href);
  const camera = state.camera;
  url.searchParams.set(keys.version, "1");
  url.searchParams.set(keys.lon, camera.center[0].toFixed(6));
  url.searchParams.set(keys.lat, camera.center[1].toFixed(6));
  url.searchParams.set(keys.zoom, camera.zoom.toFixed(2));
  url.searchParams.set(keys.bearing, (camera.bearing ?? 0).toFixed(2));
  url.searchParams.set(keys.pitch, (camera.pitch ?? 0).toFixed(2));
  url.searchParams.set(keys.workspace, state.workspace);
  url.searchParams.set(keys.basemap, state.basemap);
  setList(url, keys.tracks, state.trackLayerIds);
  setList(url, keys.catalog, state.catalogLayerIds);
  setList(url, keys.safety, state.safetyLayerIds);
  setList(url, keys.situation, state.situationLayerIds);
  if (state.selectedObjectId) url.searchParams.set(keys.selected, state.selectedObjectId.slice(0, maxSelectedIdLength));
  else url.searchParams.delete(keys.selected);
  return url.toString();
}

export function decodeCopMapShareSearch(search: string): CopMapShareState | null {
  const params = new URLSearchParams(search);
  if (params.get(keys.version) !== "1") return null;
  const lon = finiteParam(params, keys.lon);
  const lat = finiteParam(params, keys.lat);
  const zoom = finiteParam(params, keys.zoom);
  const bearing = finiteParam(params, keys.bearing);
  const pitch = finiteParam(params, keys.pitch);
  if (
    lon === null ||
    lat === null ||
    zoom === null ||
    bearing === null ||
    pitch === null ||
    Math.abs(lon) > 180 ||
    Math.abs(lat) > 90 ||
    zoom < 0 ||
    zoom > 24 ||
    Math.abs(bearing) > 360 ||
    pitch < 0 ||
    pitch > 85
  )
    return null;
  const workspaceValue = params.get(keys.workspace);
  const workspace = workspaceValue === "alerts" || workspaceValue === "data" ? workspaceValue : "map";
  const basemapValue = params.get(keys.basemap);
  const basemap: MapBasemapMode =
    basemapValue === "civil" ||
    basemapValue === "dark" ||
    basemapValue === "outline" ||
    basemapValue === "risk" ||
    basemapValue === "standard"
      ? basemapValue
      : "civil";
  const selected = params.get(keys.selected)?.trim();
  return {
    basemap,
    camera: { bearing, center: [lon, lat], pitch, zoom },
    catalogLayerIds: readList(params, keys.catalog),
    safetyLayerIds: readList(params, keys.safety),
    ...(selected && selected.length <= maxSelectedIdLength ? { selectedObjectId: selected } : {}),
    situationLayerIds: readList(params, keys.situation),
    trackLayerIds: readList(params, keys.tracks),
    version: 1,
    workspace
  };
}

function setList(url: URL, key: string, values: string[]) {
  const normalized = normalizeList(values);
  if (normalized.length > 0) url.searchParams.set(key, normalized.join(","));
  else url.searchParams.delete(key);
}

function readList(params: URLSearchParams, key: string): string[] {
  return normalizeList((params.get(key) ?? "").split(","));
}

function normalizeList(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => /^[a-z0-9_.:-]{1,80}$/iu.test(value)))
  ).slice(0, maxLayerIds);
}

function finiteParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
