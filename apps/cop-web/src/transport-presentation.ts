import type { SituationFeature } from "./cop-data";

export const transportIconKinds = ["metro", "tram", "bus", "train", "trolleybus", "ferry", "funicular", "stop", "road_event", "traffic", "unknown"] as const;

export type TransportIconKind = (typeof transportIconKinds)[number];

export interface TransportPresentation {
  color: string;
  currentStatus?: string;
  delaySeconds?: number;
  detailUrl?: string;
  destination?: string;
  headingDeg?: number;
  kind: TransportIconKind;
  label: string;
  mapLabel: string;
  occupancyPercent?: number;
  occupancyStatus?: string;
  operator?: string;
  positionKind?: "static_stop" | "vehicle_live" | "vehicle_live_cached" | string;
  refreshSeconds?: number;
  routeShortName?: string;
  speedMps?: number;
  stableKey: string;
  stopId?: string;
  stopName?: string;
  stopSequence?: number;
  systemId?: string;
  tripId?: string;
  vehicleId?: string;
  zoneId?: string;
}

export function resolveTransportPresentation(feature: SituationFeature): TransportPresentation | null {
  const properties = feature.properties as unknown as Record<string, unknown>;
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const providerProperties = isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
  const transitProperties = isRecord(providerProperties.transit) ? providerProperties.transit : {};
  const providerMetrics = isRecord(providerProperties.metrics) ? providerProperties.metrics : {};
  const providerTags = isRecord(providerProperties.tags) ? providerProperties.tags : {};
  const staticStop = recordBoolean(transitProperties, "staticOnly")
    || recordString(properties, "sourceId") === "public_transit_static"
    || recordString(properties, "layerId") === "public.traffic.transit_stops";
  if (staticStop) {
    const stopName = recordString(transitProperties, "stopName")
      ?? recordString(properties, "stopName")
      ?? recordString(properties, "label")
      ?? feature.properties.label
      ?? "Zastávka";
    return {
      color: transportIconColor("stop"),
      currentStatus: "static",
      detailUrl: recordString(transitProperties, "detailUrl") ?? recordString(providerProperties, "detailUrl") ?? recordString(properties, "detailUrl"),
      kind: "stop",
      label: "Zastávka",
      mapLabel: stopName,
      operator: recordString(transitProperties, "systemId") ?? recordString(properties, "systemId"),
      positionKind: "static_stop",
      refreshSeconds: recordNumber(transitProperties, "refreshSeconds"),
      stableKey: stableTransportStopKey(feature, transitProperties, properties, stopName),
      stopId: recordString(transitProperties, "stopId") ?? recordString(properties, "stopId"),
      stopName,
      systemId: recordString(transitProperties, "systemId") ?? recordString(properties, "systemId"),
      zoneId: recordString(transitProperties, "zoneId") ?? recordString(properties, "zoneId")
    };
  }
  const vehicleId = recordString(properties, "vehicleId") ?? recordString(tags, "vehicleId") ?? recordString(providerTags, "vehicleId") ?? recordString(transitProperties, "vehicleId");
  const rawKind = recordString(properties, "transportMode")
    ?? recordString(properties, "routeType")
    ?? recordString(properties, "vehicleType")
    ?? recordNumber(properties, "routeTypeCode")
    ?? recordNumber(metrics, "routeTypeCode")
    ?? recordNumber(providerMetrics, "routeTypeCode")
    ?? recordString(tags, "transportMode")
    ?? recordString(providerTags, "transportMode")
    ?? recordString(transitProperties, "transportMode")
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

  const routeShortName = resolveRouteShortName(kind, properties, tags, providerTags, transitProperties, vehicleId);
  const headingDeg = normalizeHeadingDeg(
    recordNumber(properties, "headingDeg")
      ?? recordNumber(metrics, "headingDeg")
      ?? recordNumber(providerMetrics, "headingDeg")
      ?? recordNumber(metrics, "bearing")
      ?? recordNumber(providerMetrics, "bearing")
      ?? recordNumber(transitProperties, "headingDeg")
  );
  const label = transportKindLabel(kind);
  const trafficEventType = kind === "road_event"
    ? formatRoadEventType(recordString(tags, "srtiType") ?? recordString(providerTags, "srtiType") ?? feature.properties.label)
    : undefined;

  return {
    color: transportIconColor(kind),
    currentStatus: recordString(properties, "currentStatus") ?? recordString(tags, "currentStatus") ?? recordString(providerTags, "currentStatus") ?? recordString(transitProperties, "currentStatus"),
    delaySeconds: recordNumber(properties, "delaySeconds") ?? recordNumber(metrics, "delaySeconds") ?? recordNumber(providerMetrics, "delaySeconds") ?? recordNumber(transitProperties, "delaySeconds"),
    detailUrl: recordString(transitProperties, "detailUrl") ?? recordString(providerProperties, "detailUrl") ?? recordString(properties, "detailUrl"),
    destination: recordString(properties, "destination")
      ?? recordString(properties, "headsign")
      ?? recordString(tags, "destination")
      ?? recordString(providerTags, "destination")
      ?? recordString(transitProperties, "destination")
      ?? recordString(tags, "headsign")
      ?? recordString(providerTags, "headsign"),
    headingDeg,
    kind,
    label: trafficEventType ?? label,
    mapLabel: routeShortName ?? trafficEventType ?? label,
    occupancyPercent: recordNumber(properties, "occupancyPercent") ?? recordNumber(metrics, "occupancyPercent") ?? recordNumber(providerMetrics, "occupancyPercent") ?? recordNumber(transitProperties, "occupancyPercent"),
    occupancyStatus: recordString(properties, "occupancyStatus") ?? recordString(tags, "occupancyStatus") ?? recordString(providerTags, "occupancyStatus") ?? recordString(transitProperties, "occupancyStatus"),
    operator: recordString(properties, "operator") ?? recordString(tags, "operator") ?? recordString(providerTags, "operator") ?? recordString(transitProperties, "operator") ?? recordString(tags, "agency") ?? recordString(providerTags, "agency"),
    positionKind: recordString(transitProperties, "positionKind") ?? recordString(properties, "positionKind"),
    refreshSeconds: recordNumber(transitProperties, "refreshSeconds") ?? recordNumber(properties, "refreshSeconds"),
    routeShortName,
    speedMps: recordNumber(properties, "speedMps") ?? recordNumber(metrics, "speedMps") ?? recordNumber(providerMetrics, "speedMps") ?? recordNumber(transitProperties, "speedMps"),
    stableKey: stableTransportVehicleKey(feature, kind, routeShortName, vehicleId, transitProperties, properties, tags, providerTags),
    stopSequence: recordNumber(properties, "currentStopSequence") ?? recordNumber(metrics, "currentStopSequence") ?? recordNumber(providerMetrics, "currentStopSequence") ?? recordNumber(transitProperties, "currentStopSequence"),
    tripId: recordString(properties, "tripId") ?? recordString(tags, "tripId") ?? recordString(providerTags, "tripId") ?? recordString(transitProperties, "tripId"),
    vehicleId
  };
}

export function transportSelectionKey(feature: SituationFeature): string | undefined {
  const presentation = resolveTransportPresentation(feature);
  if (!presentation) {
    return undefined;
  }
  return `traffic:${presentation.stableKey}`;
}

export function isTransitVehicleSelectionKey(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("traffic:vehicle:");
}

export function transportIconColor(kind: TransportIconKind): string {
  const colors: Record<TransportIconKind, string> = {
    bus: "#1f6feb",
    ferry: "#00838f",
    funicular: "#8d6e63",
    metro: "#0072bc",
    road_event: "#fb923c",
    stop: "#0ea5e9",
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
    stop: "Zastávka",
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
  if (normalizedLayerId.includes("traffictransitstops") || normalizedCategory.includes("stop") || normalizedCategory.includes("zastav")) {
    return "stop";
  }
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

function resolveRouteShortName(
  kind: TransportIconKind,
  properties: Record<string, unknown>,
  tags: Record<string, unknown>,
  providerTags: Record<string, unknown>,
  transitProperties: Record<string, unknown>,
  vehicleId: string | undefined
): string | undefined {
  const route = compactTransportRouteLabel(
    recordString(properties, "routeShortName")
      ?? recordString(transitProperties, "routeShortName")
      ?? recordString(properties, "route")
      ?? recordString(providerTags, "routeShortName")
      ?? recordString(tags, "route")
      ?? recordString(providerTags, "route")
      ?? recordString(transitProperties, "route")
      ?? recordString(properties, "line")
      ?? recordString(tags, "line")
      ?? recordString(providerTags, "line")
      ?? recordString(transitProperties, "line")
      ?? recordString(properties, "routeId")
      ?? recordString(tags, "routeId")
      ?? recordString(providerTags, "routeId")
      ?? recordString(transitProperties, "routeId")
  );
  if (kind === "metro") {
    const inferred = inferMetroLineFromVehicleId(vehicleId);
    if (inferred && (!route || /^\d{3,}$/.test(route))) {
      return inferred;
    }
  }
  return route;
}

function stableTransportStopKey(
  feature: SituationFeature,
  transitProperties: Record<string, unknown>,
  properties: Record<string, unknown>,
  stopName: string
): string {
  const source = recordString(properties, "sourceId") ?? feature.properties.sourceId ?? "unknown-source";
  const systemId = recordString(transitProperties, "systemId") ?? recordString(properties, "systemId") ?? "unknown-system";
  const stopId = recordString(transitProperties, "stopId") ?? recordString(properties, "stopId");
  return ["stop", source, systemId, stopId ?? stopName].join(":");
}

function stableTransportVehicleKey(
  feature: SituationFeature,
  kind: TransportIconKind,
  routeShortName: string | undefined,
  vehicleId: string | undefined,
  transitProperties: Record<string, unknown>,
  properties: Record<string, unknown>,
  tags: Record<string, unknown>,
  providerTags: Record<string, unknown>
): string {
  const source = recordString(properties, "sourceId") ?? feature.properties.sourceId ?? "unknown-source";
  const tripId = recordString(properties, "tripId")
    ?? recordString(tags, "tripId")
    ?? recordString(providerTags, "tripId")
    ?? recordString(transitProperties, "tripId");
  const routeId = recordString(properties, "routeId")
    ?? recordString(tags, "routeId")
    ?? recordString(providerTags, "routeId")
    ?? recordString(transitProperties, "routeId")
    ?? routeShortName;
  return ["vehicle", source, vehicleId ?? tripId ?? routeId ?? feature.properties.featureId, kind].join(":");
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

function recordBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }
  return false;
}
