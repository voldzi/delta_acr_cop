import type { SketchDrawingFeature, SketchDrawingKind, SketchDrawingVisibility, SketchGeometry } from "./cop-data";

export type SketchToolMode =
  "arrow" | "circle" | "line" | "marker" | "measurement" | "pan" | "polygon" | "select" | "text";
export type SketchFillPattern = "dash" | "hatch" | "outline" | "solid";
export type SketchSymbolPalette = "civil" | "professional";

export interface SketchSymbolPreset {
  glyph: string;
  iconId: string;
  label: string;
  palette: SketchSymbolPalette;
  shape?: "circle" | "cross" | "diamond" | "pin" | "rectangle" | "square" | "star" | "triangle" | "wave";
  sidc?: string;
  tone?: "critical" | "info" | "neutral" | "ok" | "professional" | "warning";
}

export interface SketchStyleSettings {
  fill: string;
  lineWidth: number;
  opacity: number;
  stroke: string;
}

export interface SketchFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: SketchGeometry;
    properties: {
      bearing?: number;
      drawingId: string;
      fill: string;
      fillPattern?: SketchFillPattern;
      iconGlyph?: string;
      kind: SketchDrawingKind | "arrowhead";
      label: string;
      lineWidth: number;
      opacity: number;
      selected: boolean;
      stroke: string;
    };
  }>;
}

export interface SketchDraftFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry:
      | { type: "LineString"; coordinates: Array<[number, number]> }
      | { type: "Point"; coordinates: [number, number] }
      | { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
    properties: { index?: number; kind: "area" | "line" | "point" };
  }>;
}

export interface SketchEditFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: {
      drawingId: string;
      index?: number;
      insertIndex?: number;
      kind: "midpoint" | "vertex";
      selected?: boolean;
    };
  }>;
}

export const defaultSketchStyle = {
  fill: "#2f80ed",
  lineWidth: 2,
  opacity: 0.24,
  stroke: "#2f80ed"
} satisfies SketchStyleSettings;

export const sketchColorSwatches = [
  "#2f80ed",
  "#22c55e",
  "#facc15",
  "#f97316",
  "#ef4444",
  "#a855f7",
  "#38bdf8",
  "#f8fafc"
] as const;

export const sketchSymbolPresets: SketchSymbolPreset[] = [
  { glyph: "⚠", iconId: "warning", label: "Upozornění", palette: "civil", shape: "triangle", tone: "warning" },
  { glyph: "⛔", iconId: "closure", label: "Uzávěra", palette: "civil", shape: "circle", tone: "critical" },
  { glyph: "✚", iconId: "help", label: "Pomoc", palette: "civil", shape: "cross", tone: "ok" },
  { glyph: "⊕", iconId: "meeting-point", label: "Místo setkání", palette: "civil", shape: "pin", tone: "ok" },
  { glyph: "≋", iconId: "water-source", label: "Zdroj vody", palette: "civil", shape: "wave", tone: "info" },
  { glyph: "↗", iconId: "evacuation", label: "Evakuační bod", palette: "civil", shape: "pin", tone: "info" },
  { glyph: "◆", iconId: "risk", label: "Riziko", palette: "civil", shape: "diamond", tone: "critical" },
  { glyph: "i", iconId: "note", label: "Poznámka", palette: "civil", shape: "circle", tone: "neutral" },
  { glyph: "★", iconId: "shape-star", label: "Hvězda", palette: "civil", shape: "star", tone: "info" },
  { glyph: "●", iconId: "shape-circle", label: "Kruh", palette: "civil", shape: "circle", tone: "info" },
  { glyph: "■", iconId: "shape-square", label: "Čtverec", palette: "civil", shape: "square", tone: "info" },
  { glyph: "▬", iconId: "shape-rectangle", label: "Obdélník", palette: "civil", shape: "rectangle", tone: "info" },
  { glyph: "◆", iconId: "shape-diamond", label: "Kosočtverec", palette: "civil", shape: "diamond", tone: "warning" },
  { glyph: "▲", iconId: "shape-triangle", label: "Trojúhelník", palette: "civil", shape: "triangle", tone: "warning" },
  { glyph: "≋", iconId: "shape-wave", label: "Vlnka", palette: "civil", shape: "wave", tone: "info" },
  { glyph: "✚", iconId: "shape-cross", label: "Kříž", palette: "civil", shape: "cross", tone: "ok" },
  {
    glyph: "□",
    iconId: "app6-friendly",
    label: "APP-6 vlastní",
    palette: "professional",
    sidc: "10031000001211000000",
    tone: "professional"
  },
  {
    glyph: "▭",
    iconId: "app6-neutral",
    label: "APP-6 neutrální",
    palette: "professional",
    sidc: "10031000001211000000",
    tone: "professional"
  },
  {
    glyph: "◇",
    iconId: "app6-unknown",
    label: "APP-6 neznámé",
    palette: "professional",
    sidc: "10011000001211000000",
    tone: "professional"
  }
];

export const defaultSketchSymbol = sketchSymbolPresets[0]!;

export function emptySketchFeatureCollection(): SketchFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function emptySketchDraftFeatureCollection(): SketchDraftFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function emptySketchEditFeatureCollection(): SketchEditFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function isSketchFillPattern(value: unknown): value is SketchFillPattern {
  return value === "dash" || value === "hatch" || value === "outline" || value === "solid";
}

export function sketchPresetToSymbolInput(
  preset: SketchSymbolPreset
): Partial<SketchDrawingFeature["properties"]["symbol"]> {
  return {
    iconId: preset.iconId,
    palette: preset.palette,
    ...(preset.sidc ? { sidc: preset.sidc } : {})
  };
}

export function sketchSymbolGlyph(iconId: string | undefined, sidc: string | undefined): string {
  const preset = sketchSymbolPresets.find(
    (candidate) => candidate.iconId === iconId || (sidc && candidate.sidc === sidc)
  );
  return preset?.glyph ?? "●";
}

export function sketchDrawingsToFeatureCollection(
  drawings: SketchDrawingFeature[],
  selectedDrawingId: string | null | undefined
): SketchFeatureCollection {
  const features: SketchFeatureCollection["features"] = [];
  drawings.forEach((drawing) => {
    const selected = drawing.id === selectedDrawingId;
    const drawingProperties = drawing.properties.properties ?? {};
    const fillPattern = isSketchFillPattern(drawingProperties.fillPattern) ? drawingProperties.fillPattern : "solid";
    const baseProperties = {
      drawingId: drawing.id,
      fill: drawing.properties.style.fill || "#2f80ed",
      fillPattern,
      iconGlyph: sketchSymbolGlyph(drawing.properties.symbol.iconId, drawing.properties.symbol.sidc),
      kind: drawing.properties.kind,
      label: drawing.properties.label,
      lineWidth: Number.isFinite(drawing.properties.style.lineWidth) ? drawing.properties.style.lineWidth : 2,
      opacity: Number.isFinite(drawing.properties.style.opacity) ? drawing.properties.style.opacity : 0.22,
      selected,
      stroke: drawing.properties.style.stroke || "#2f80ed"
    };
    features.push({
      type: "Feature",
      geometry: drawing.geometry,
      properties: baseProperties
    });
    const arrowHead = sketchArrowHeadFeature(drawing, baseProperties, selected);
    if (arrowHead) {
      features.push(arrowHead);
    }
  });
  return {
    type: "FeatureCollection",
    features
  };
}

export function sketchDraftToFeatureCollection(
  points: Array<{ lat: number; lon: number }>,
  mode: SketchToolMode
): SketchDraftFeatureCollection {
  if (mode === "pan" || mode === "select") {
    return emptySketchDraftFeatureCollection();
  }
  const coordinates = points.map((point): [number, number] => [point.lon, point.lat]);
  const features: SketchDraftFeatureCollection["features"] = [];
  if ((mode === "line" || mode === "measurement") && coordinates.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: { kind: "line" }
    });
  }
  if (mode === "arrow" && points.length >= 2) {
    const geometry = arrowGeometryFromDraftPoints(points);
    if (geometry) {
      features.push({
        type: "Feature",
        geometry,
        properties: { kind: "area" }
      });
    }
  }
  if (mode === "circle" && points.length >= 2) {
    const geometry = circleGeometryFromDraftPoints(points);
    if (geometry) {
      features.push({
        type: "Feature",
        geometry,
        properties: { kind: "area" }
      });
    }
  }
  if (mode === "polygon" && coordinates.length >= 2) {
    const first = coordinates[0];
    if (first) {
      features.push({
        type: "Feature",
        geometry: {
          type: coordinates.length >= 3 ? "Polygon" : "LineString",
          coordinates: coordinates.length >= 3 ? [[...coordinates, first]] : coordinates
        } as SketchDraftFeatureCollection["features"][number]["geometry"],
        properties: { kind: coordinates.length >= 3 ? "area" : "line" }
      });
    }
  }
  coordinates.forEach((coordinate, index) => {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: coordinate },
      properties: { index: index + 1, kind: "point" }
    });
  });
  return { type: "FeatureCollection", features };
}

export function sketchDrawingToEditFeatureCollection(
  drawing: SketchDrawingFeature | null,
  selectedVertexIndex: number | null = null
): SketchEditFeatureCollection {
  const points = sketchEditablePoints(drawing);
  if (!drawing || points.length === 0 || drawing.properties.locked) {
    return emptySketchEditFeatureCollection();
  }
  const features: SketchEditFeatureCollection["features"] = points.map((point, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    properties: {
      drawingId: drawing.id,
      index,
      kind: "vertex",
      selected: selectedVertexIndex === index
    }
  }));
  if (drawing.geometry.type !== "Point" && points.length >= 2) {
    points.forEach((point, index) => {
      const isPolygon = drawing.geometry.type === "Polygon";
      const nextPoint = points[index + 1] ?? (isPolygon ? points[0] : undefined);
      if (!nextPoint) {
        return;
      }
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [(point.lon + nextPoint.lon) / 2, (point.lat + nextPoint.lat) / 2]
        },
        properties: {
          drawingId: drawing.id,
          insertIndex: index + 1,
          kind: "midpoint"
        }
      });
    });
  }
  return { type: "FeatureCollection", features };
}

export function sketchEditablePoints(drawing: SketchDrawingFeature | null): Array<{ lat: number; lon: number }> {
  if (!drawing) {
    return [];
  }
  if (drawing.geometry.type === "Point") {
    const [lon, lat] = drawing.geometry.coordinates;
    return [{ lat, lon }];
  }
  if (drawing.geometry.type === "LineString") {
    return drawing.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  }
  const ring = drawing.geometry.coordinates[0] ?? [];
  return ring.slice(0, -1).map(([lon, lat]) => ({ lat, lon }));
}

export function sketchGeometryFromPoints(
  kind: SketchDrawingKind,
  points: Array<{ lat: number; lon: number }>
): SketchGeometry | null {
  const coordinates = points.map((point): [number, number] => [point.lon, point.lat]);
  if ((kind === "marker" || kind === "point" || kind === "text") && coordinates[0]) {
    return { type: "Point", coordinates: coordinates[0] };
  }
  if (kind === "arrow" && coordinates.length >= 2) {
    return arrowGeometryFromDraftPoints(points);
  }
  if ((kind === "line" || kind === "measurement") && coordinates.length >= 2) {
    return { type: "LineString", coordinates };
  }
  if (kind === "circle") {
    return circleGeometryFromDraftPoints(points);
  }
  if (kind === "polygon" && coordinates.length >= 3) {
    const first = coordinates[0];
    if (!first) {
      return null;
    }
    return { type: "Polygon", coordinates: [[...coordinates, first]] };
  }
  return null;
}

export function isSketchDraftMode(mode: SketchToolMode): boolean {
  return mode === "arrow" || mode === "circle" || mode === "line" || mode === "measurement" || mode === "polygon";
}

export function sketchDraftLabel(kind: SketchDrawingKind, measuredKm: number): string {
  if (kind === "measurement") {
    return formatMeasurementLabel(measuredKm);
  }
  if (kind === "polygon") {
    return "Oblast";
  }
  if (kind === "circle") {
    return "Kruh";
  }
  if (kind === "arrow") {
    return "Šipka";
  }
  return "Linie";
}

export function sketchDraftHint(mode: SketchToolMode, points: Array<{ lat: number; lon: number }>): string {
  if (mode === "polygon") {
    return points.length < 3 ? `Přidejte alespoň 3 body (${points.length}/3).` : `${points.length} bodů připraveno.`;
  }
  if (mode === "circle") {
    return points.length < 2
      ? `Klikněte na střed a okraj kruhu (${points.length}/2).`
      : `Poloměr ${formatMeasurementLabel(measureSketchLine(points.map((point) => [point.lon, point.lat])))}.`;
  }
  if (mode === "arrow") {
    return points.length < 2
      ? `Klikněte začátek a konec šipky (${points.length}/2).`
      : `${points.length} bodů připraveno.`;
  }
  return points.length < 2
    ? `Přidejte alespoň 2 body (${points.length}/2).`
    : formatMeasurementLabel(measureSketchLine(points.map((point) => [point.lon, point.lat])));
}

export function formatSketchDrawingSubtitle(drawing: SketchDrawingFeature): string {
  const kindLabels: Record<SketchDrawingKind, string> = {
    arrow: "šipka",
    circle: "oblast",
    line: "linie",
    marker: "značka",
    measurement: "měření",
    point: "bod",
    polygon: "polygon",
    text: "text"
  };
  const visibilityLabels: Record<SketchDrawingVisibility, string> = {
    event: "událost",
    group: "skupina",
    private: "soukromé",
    public: "veřejné"
  };
  const metric =
    drawing.geometry.type === "LineString"
      ? ` · ${formatMeasurementLabel(measureSketchLine(drawing.geometry.coordinates))}`
      : "";
  return `${kindLabels[drawing.properties.kind]} · ${visibilityLabels[drawing.properties.visibility]}${metric}`;
}

export function measureSketchLine(coordinates: Array<[number, number]>): number {
  let totalKm = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    if (!previous || !current) {
      continue;
    }
    totalKm += haversineDistanceKm(previous[1], previous[0], current[1], current[0]);
  }
  return totalKm;
}

export function formatMeasurementLabel(distanceKm: number): string {
  if (!Number.isFinite(distanceKm)) {
    return "0 m";
  }
  return distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(distanceKm >= 10 ? 1 : 2)} km`;
}

function sketchArrowHeadFeature(
  drawing: SketchDrawingFeature,
  baseProperties: Omit<SketchFeatureCollection["features"][number]["properties"], "bearing" | "kind"> & {
    kind: SketchDrawingKind;
  },
  selected: boolean
): SketchFeatureCollection["features"][number] | null {
  if (
    drawing.properties.kind !== "arrow" ||
    drawing.geometry.type !== "LineString" ||
    drawing.geometry.coordinates.length < 2
  ) {
    return null;
  }
  const end = drawing.geometry.coordinates[drawing.geometry.coordinates.length - 1];
  const previous = drawing.geometry.coordinates[drawing.geometry.coordinates.length - 2];
  if (!end || !previous) {
    return null;
  }
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: end },
    properties: {
      ...baseProperties,
      bearing: bearingDegrees(previous, end),
      kind: "arrowhead",
      label: "",
      selected
    }
  };
}

function arrowGeometryFromDraftPoints(
  points: Array<{ lat: number; lon: number }>
): Extract<SketchGeometry, { type: "Polygon" }> | null {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) {
    return null;
  }
  const dx = end.lon - start.lon;
  const dy = end.lat - start.lat;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 0.000001) {
    return null;
  }
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const headLength = clampValue(length * 0.32, length * 0.18, length * 0.46);
  const shaftHalf = Math.max(length * 0.035, 0.00008);
  const headHalf = Math.max(length * 0.12, shaftHalf * 2.6);
  const neckLon = end.lon - ux * headLength;
  const neckLat = end.lat - uy * headLength;
  const ring: Array<[number, number]> = [
    [start.lon + nx * shaftHalf, start.lat + ny * shaftHalf],
    [neckLon + nx * shaftHalf, neckLat + ny * shaftHalf],
    [neckLon + nx * headHalf, neckLat + ny * headHalf],
    [end.lon, end.lat],
    [neckLon - nx * headHalf, neckLat - ny * headHalf],
    [neckLon - nx * shaftHalf, neckLat - ny * shaftHalf],
    [start.lon - nx * shaftHalf, start.lat - ny * shaftHalf],
    [start.lon + nx * shaftHalf, start.lat + ny * shaftHalf]
  ];
  return { type: "Polygon", coordinates: [ring] };
}

function circleGeometryFromDraftPoints(
  points: Array<{ lat: number; lon: number }>
): Extract<SketchGeometry, { type: "Polygon" }> | null {
  const center = points[0];
  const edge = points[1];
  if (!center || !edge) {
    return null;
  }
  const radiusKm = haversineDistanceKm(center.lat, center.lon, edge.lat, edge.lon);
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    return null;
  }
  const earthRadiusKm = 6371.0088;
  const toRadians = Math.PI / 180;
  const toDegrees = 180 / Math.PI;
  const centerLat = center.lat * toRadians;
  const centerLon = center.lon * toRadians;
  const angularDistance = radiusKm / earthRadiusKm;
  const ring: Array<[number, number]> = [];
  for (let index = 0; index <= 64; index += 1) {
    const bearing = (index / 64) * Math.PI * 2;
    const lat = Math.asin(
      Math.sin(centerLat) * Math.cos(angularDistance) +
        Math.cos(centerLat) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lon =
      centerLon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centerLat),
        Math.cos(angularDistance) - Math.sin(centerLat) * Math.sin(lat)
      );
    const normalizedLon = (((lon * toDegrees + 540) % 360) - 180) as number;
    ring.push([normalizedLon, lat * toDegrees]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

function haversineDistanceKm(latA: number, lonA: number, latB: number, lonB: number): number {
  const radiusKm = 6371.0088;
  const toRadians = Math.PI / 180;
  const phi1 = latA * toRadians;
  const phi2 = latB * toRadians;
  const deltaPhi = (latB - latA) * toRadians;
  const deltaLambda = (lonB - lonA) * toRadians;
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(from: [number, number], to: [number, number]): number {
  const toRadians = Math.PI / 180;
  const toDegrees = 180 / Math.PI;
  const [lonA, latA] = from;
  const [lonB, latB] = to;
  const phi1 = latA * toRadians;
  const phi2 = latB * toRadians;
  const deltaLambda = (lonB - lonA) * toRadians;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return (Math.atan2(y, x) * toDegrees - 90 + 360) % 360;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
