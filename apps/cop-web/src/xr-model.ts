import { isPublicFlightObject, type CopObject, type ServerTrackHistoryPoint, type SourceSystem } from "./cop-data";
import { formatTrackLabel } from "./track-label";

const maxXrObjects = 260;
const boardWidthM = 16;
const boardDepthM = 9;

export interface XrObjectModel {
  affiliation: string;
  color: string;
  confidence?: number;
  domain: string;
  headingDeg?: number;
  history: Array<{ x: number; y: number; z: number }>;
  isPublicFlight: boolean;
  isSimulated: boolean;
  label: string;
  lat: number;
  lon: number;
  objectId: string;
  objectType: string;
  position: { x: number; y: number; z: number };
  prediction?: { x: number; y: number; z: number };
  status: string;
}

export function buildXrObjectModels(
  objects: CopObject[],
  trackHistory: Record<string, ServerTrackHistoryPoint[]> = {},
  options: { maxObjects?: number } = {}
): XrObjectModel[] {
  const positionedObjects = objects.filter((object) => object.position);
  const limitedObjects = positionedObjects.slice(0, options.maxObjects ?? maxXrObjects);
  const projection = createProjection(limitedObjects);
  return limitedObjects.map((object) => {
    const projectedPosition = projection.project(object.position?.lat ?? 0, object.position?.lon ?? 0);
    const y = object.domain === "AIR"
      ? clampNumber(0.55 + ((object.position?.altitudeM ?? 0) / 3000), 0.65, 4.2)
      : 0.22;
    const headingDeg = normalizeHeading(object.movement?.headingDeg ?? object.headingDeg);
    const history = (trackHistory[object.objectId] ?? [])
      .slice(-24)
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
      .map((point) => {
        const projected = projection.project(point.lat, point.lon);
        return {
          x: projected.x,
          y: object.domain === "AIR" ? y * 0.86 : 0.18,
          z: projected.z
        };
      });
    return {
      affiliation: object.affiliation,
      color: colorForXrObject(object),
      confidence: object.confidence,
      domain: object.domain,
      headingDeg,
      history,
      isPublicFlight: isPublicFlightObject(object),
      isSimulated: isSimulatedObject(object),
      label: formatXrObjectLabel(object),
      lat: object.position?.lat ?? 0,
      lon: object.position?.lon ?? 0,
      objectId: object.objectId,
      objectType: object.objectType,
      position: {
        x: projectedPosition.x,
        y,
        z: projectedPosition.z
      },
      prediction: buildPredictionPoint(object, projection, y),
      status: object.status
    };
  });
}

export function summarizeXrObjects(models: XrObjectModel[], sources: SourceSystem[] = []) {
  return {
    activeSources: sources.filter((source) => source.status === "ACTIVE").length,
    publicFlights: models.filter((model) => model.isPublicFlight).length,
    simulated: models.filter((model) => model.isSimulated).length,
    visibleObjects: models.length
  };
}

export function formatXrObjectLabel(object: CopObject): string {
  return formatTrackLabel(object);
}

export function isSimulatedObject(object: CopObject): boolean {
  if (isPublicFlightObject(object)) {
    return false;
  }
  return Boolean(object.synthetic) || object.attributes?.provenance?.sourceSystemId?.toLowerCase().includes("sim") === true;
}

function createProjection(objects: CopObject[]) {
  const positions = objects.map((object) => object.position).filter((position): position is NonNullable<CopObject["position"]> => Boolean(position));
  const centerLat = average(positions.map((position) => position.lat)) ?? 50.08;
  const centerLon = average(positions.map((position) => position.lon)) ?? 14.42;
  const projected = positions.map((position) => projectKm(position.lat, position.lon, centerLat, centerLon));
  const maxX = Math.max(...projected.map((point) => Math.abs(point.x)), 1);
  const maxZ = Math.max(...projected.map((point) => Math.abs(point.z)), 1);
  const scale = Math.min((boardWidthM * 0.43) / maxX, (boardDepthM * 0.43) / maxZ, 0.22);
  return {
    project: (lat: number, lon: number) => {
      const km = projectKm(lat, lon, centerLat, centerLon);
      return {
        x: clampNumber(km.x * scale, -boardWidthM * 0.48, boardWidthM * 0.48),
        z: clampNumber(km.z * scale, -boardDepthM * 0.48, boardDepthM * 0.48)
      };
    },
    scale
  };
}

function projectKm(lat: number, lon: number, centerLat: number, centerLon: number): { x: number; z: number } {
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.32 * Math.cos(degToRad(centerLat));
  return {
    x: (lon - centerLon) * kmPerDegLon,
    z: -(lat - centerLat) * kmPerDegLat
  };
}

function buildPredictionPoint(
  object: CopObject,
  projection: { project: (lat: number, lon: number) => { x: number; z: number }; scale: number },
  y: number
): { x: number; y: number; z: number } | undefined {
  const heading = normalizeHeading(object.movement?.headingDeg ?? object.headingDeg);
  const speed = object.movement?.speedMps ?? object.speedMps;
  const position = object.position;
  if (heading === undefined || speed === undefined || speed === null || speed < 1 || !position) {
    return undefined;
  }
  const distanceKm = clampNumber((speed * 300) / 1000, 0.2, 80);
  const headingRad = degToRad(heading);
  const base = projection.project(position.lat, position.lon);
  return {
    x: base.x + Math.sin(headingRad) * distanceKm * projection.scale,
    y,
    z: base.z - Math.cos(headingRad) * distanceKm * projection.scale
  };
}

function colorForXrObject(object: CopObject): string {
  if (isPublicFlightObject(object)) {
    return "#facc15";
  }
  if (object.affiliation === "FRIEND" || object.affiliation === "ASSUMED_FRIEND") {
    return "#60a5fa";
  }
  if (object.affiliation === "HOSTILE" || object.affiliation === "SUSPECT") {
    return "#ef4444";
  }
  if (object.affiliation === "NEUTRAL") {
    return "#22c55e";
  }
  return "#eab308";
}

function normalizeHeading(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return ((value % 360) + 360) % 360;
}

function average(values: number[]): number | undefined {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}
