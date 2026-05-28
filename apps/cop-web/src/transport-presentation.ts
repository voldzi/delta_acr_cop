import type { SituationFeature } from "./cop-data";

export const transportIconKinds = ["metro", "tram", "bus", "train", "trolleybus", "ferry", "funicular", "road_event", "traffic", "unknown"] as const;

export type TransportIconKind = (typeof transportIconKinds)[number];

export interface TransportPresentation {
  color: string;
  currentStatus?: string;
  delaySeconds?: number;
  destination?: string;
  headingDeg?: number;
  kind: TransportIconKind;
  label: string;
  mapLabel: string;
  occupancyPercent?: number;
  occupancyStatus?: string;
  operator?: string;
  routeShortName?: string;
  speedMps?: number;
  stopSequence?: number;
  tripId?: string;
  vehicleId?: string;
}

export function resolveTransportPresentation(feature: SituationFeature): TransportPresentation | null {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
  const providerMetrics = isRecord(providerProperties.metrics) ? providerProperties.metrics : {};
  const providerTags = isRecord(providerProperties.tags) ? providerProperties.tags : {};
  const vehicleId = recordString(tags, "vehicleId") ?? recordString(providerTags, "vehicleId");
  const rawKind = recordNumber(metrics, "routeTypeCode")
    ?? recordNumber(providerMetrics, "routeTypeCode")
    ?? recordString(tags, "transportMode")
    ?? recordString(providerTags, "transportMode")
    ?? recordString(tags, "routeType")
    ?? recordString(providerTags, "routeType")
    ?? recordString(tags, "vehicleType")
    ?? recordString(providerTags, "vehicleType")
    ?? feature.properties.category
    ?? feature.properties.label;
  const kind = normalizeTransportIconKind(rawKind, feature);
  if (!kind) {
    return null;
  }

  const routeShortName = resolveRouteShortName(kind, tags, providerTags, vehicleId);
  const headingDeg = normalizeHeadingDeg(
    recordNumber(metrics, "headingDeg")
      ?? recordNumber(providerMetrics, "headingDeg")
      ?? recordNumber(metrics, "bearing")
      ?? recordNumber(providerMetrics, "bearing")
  );
  const label = transportKindLabel(kind);
  const trafficEventType = kind === "road_event"
    ? formatRoadEventType(recordString(tags, "srtiType") ?? recordString(providerTags, "srtiType") ?? feature.properties.label)
    : undefined;

  return {
    color: transportIconColor(kind),
    currentStatus: recordString(tags, "currentStatus") ?? recordString(providerTags, "currentStatus"),
    delaySeconds: recordNumber(metrics, "delaySeconds") ?? recordNumber(providerMetrics, "delaySeconds"),
    destination: recordString(tags, "destination") ?? recordString(providerTags, "destination") ?? recordString(tags, "headsign") ?? recordString(providerTags, "headsign"),
    headingDeg,
    kind,
    label: trafficEventType ?? label,
    mapLabel: routeShortName ?? trafficEventType ?? label,
    occupancyPercent: recordNumber(metrics, "occupancyPercent") ?? recordNumber(providerMetrics, "occupancyPercent"),
    occupancyStatus: recordString(tags, "occupancyStatus") ?? recordString(providerTags, "occupancyStatus"),
    operator: recordString(tags, "operator") ?? recordString(providerTags, "operator") ?? recordString(tags, "agency") ?? recordString(providerTags, "agency"),
    routeShortName,
    speedMps: recordNumber(metrics, "speedMps") ?? recordNumber(providerMetrics, "speedMps"),
    stopSequence: recordNumber(metrics, "currentStopSequence") ?? recordNumber(providerMetrics, "currentStopSequence"),
    tripId: recordString(tags, "tripId") ?? recordString(providerTags, "tripId"),
    vehicleId
  };
}

export function transportIconColor(kind: TransportIconKind): string {
  const colors: Record<TransportIconKind, string> = {
    bus: "#1f6feb",
    ferry: "#00838f",
    funicular: "#8d6e63",
    metro: "#0072bc",
    road_event: "#fb923c",
    traffic: "#facc15",
    train: "#2e7d32",
    tram: "#d71920",
    trolleybus: "#7b3f98",
    unknown: "#8cb6d8"
  };
  return colors[kind];
}

export function transportKindLabel(kind: TransportIconKind): string {
  const labels: Record<TransportIconKind, string> = {
    bus: "Bus",
    ferry: "Přívoz",
    funicular: "Lanovka",
    metro: "Metro",
    road_event: "Silniční událost",
    traffic: "Doprava",
    train: "Vlak",
    tram: "Tram",
    trolleybus: "Trolejbus",
    unknown: "Doprava"
  };
  return labels[kind];
}

export function formatTransportCurrentStatus(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return "n/a";
  }
  const labels: Record<string, string> = {
    incoming_at: "přijíždí",
    in_transit_to: "na trase",
    stopped_at: "ve stanici"
  };
  return labels[normalized] ?? value!.replace(/_/g, " ");
}

export function formatTransportDelay(seconds: number | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "n/a";
  }
  if (Math.abs(seconds) < 30) {
    return "včas";
  }
  const minutes = Math.round(seconds / 60);
  return minutes > 0 ? `+${minutes} min` : `${minutes} min`;
}

export function formatTransportOccupancy(status: string | undefined, percent: number | undefined): string {
  const normalized = status?.trim().toLowerCase();
  const labels: Record<string, string> = {
    empty: "volno",
    few_seats_available: "volná místa",
    full: "plno",
    many_seats_available: "dostatek míst",
    standing_room_only: "jen stání"
  };
  const statusLabel = normalized ? labels[normalized] ?? status!.replace(/_/g, " ") : undefined;
  const percentLabel = typeof percent === "number" && Number.isFinite(percent) ? `${Math.round(percent)} %` : undefined;
  return [statusLabel, percentLabel].filter(Boolean).join(" · ") || "n/a";
}

export function formatTransportSpeed(speedMps: number | undefined): string {
  if (typeof speedMps !== "number" || !Number.isFinite(speedMps)) {
    return "n/a";
  }
  return `${Math.round(speedMps * 3.6)} km/h`;
}

export function formatTransportHeading(headingDeg: number | undefined): string {
  return typeof headingDeg === "number" && Number.isFinite(headingDeg) ? `${Math.round(headingDeg)}°` : "n/a";
}

function normalizeTransportIconKind(value: unknown, feature: SituationFeature): TransportIconKind | undefined {
  if (typeof value === "number") {
    if (value === 0) return "tram";
    if (value === 1) return "metro";
    if (value === 2) return "train";
    if (value === 3) return "bus";
    if (value === 4) return "ferry";
    if (value === 5) return "funicular";
    if (value === 11) return "trolleybus";
  }
  const normalizedCategory = normalizeCompactAscii(feature.properties.category);
  const normalizedLayerId = normalizeCompactAscii(feature.properties.layerId ?? "");
  if (normalizedCategory.includes("roadtraffic") || normalizedLayerId.includes("roadevent")) {
    return "road_event";
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = normalizeCompactAscii(value);
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("tram")) return "tram";
  if (normalized.includes("metro") || normalized === "subway") return "metro";
  if (normalized.includes("trolley")) return "trolleybus";
  if (normalized.includes("bus")) return "bus";
  if (normalized.includes("train") || normalized.includes("rail") || normalized.includes("vlak")) return "train";
  if (normalized.includes("ferry") || normalized.includes("privoz")) return "ferry";
  if (normalized.includes("funicular") || normalized.includes("lanov")) return "funicular";
  if (normalized.includes("abnormaltraffic") || normalized.includes("roadtraffic")) return "road_event";
  if (normalized.includes("traffic") || normalized.includes("transport") || normalized.includes("doprava")) return "traffic";
  return undefined;
}

function resolveRouteShortName(kind: TransportIconKind, tags: Record<string, unknown>, providerTags: Record<string, unknown>, vehicleId: string | undefined): string | undefined {
  const route = compactTransportRouteLabel(
    recordString(tags, "routeShortName")
      ?? recordString(providerTags, "routeShortName")
      ?? recordString(tags, "route")
      ?? recordString(providerTags, "route")
      ?? recordString(tags, "line")
      ?? recordString(providerTags, "line")
      ?? recordString(tags, "routeId")
      ?? recordString(providerTags, "routeId")
  );
  if (kind === "metro") {
    const inferred = inferMetroLineFromVehicleId(vehicleId);
    if (inferred && (!route || /^\d{3,}$/.test(route))) {
      return inferred;
    }
  }
  return route;
}

function inferMetroLineFromVehicleId(vehicleId: string | undefined): string | undefined {
  const match = vehicleId?.match(/(?:^|[-_])metro[-_]?([A-Za-z0-9]{1,3})(?:[-_]|$)/i);
  return match?.[1]?.toUpperCase();
}

function compactTransportRouteLabel(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^L(?=\d)/i, "").replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 8 ? `${normalized.slice(0, 7)}…` : normalized;
}

function formatRoadEventType(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  const compact = normalizeCompactAscii(normalized);
  if (compact.includes("abnormaltraffic")) {
    return "Kolona";
  }
  if (compact.includes("accident")) {
    return "Nehoda";
  }
  if (compact.includes("roadworks")) {
    return "Práce";
  }
  return normalized.replace(/^Silniční událost:\s*/i, "").replace(/_/g, " ").slice(0, 16);
}

function normalizeHeadingDeg(value: number | null | undefined): number | undefined {
  const heading = Number(value);
  if (!Number.isFinite(heading)) {
    return undefined;
  }
  return ((heading % 360) + 360) % 360;
}

function normalizeCompactAscii(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[_\s./-]+/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : undefined;
}

function recordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
