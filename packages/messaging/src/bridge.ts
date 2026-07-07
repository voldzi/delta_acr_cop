// Cross-app wire contract between cop-chat (embedded iframe) and cop-web (host).
//
// cop-chat runs as a same-origin iframe inside cop-web. They communicate over
// postMessage / BroadcastChannel / localStorage, never via shared function
// calls. All message `type` discriminators, the channel name, the storage key
// and the payload encoders/decoders live here so both sides reference one
// source of truth instead of duplicated string literals. Changing any value
// here is a breaking contract change and must stay in sync across both apps.

export const chatBridgeMessageTypes = {
  centerLocation: "cop-chat:center-location",
  currentLocation: "cop-chat:current-location",
  select: "cop-chat:select",
  shareTransit: "cop-chat:share-transit",
  unread: "cop-chat:unread"
} as const;

export const chatBridgeChannelName = "cop-chat";
export const chatUnreadStorageKey = "cop.chat.unread.v1";
const nullIslandThresholdDeg = 0.0001;

export interface ChatUnreadMessage {
  at: number;
  count: number;
  type: typeof chatBridgeMessageTypes.unread;
}

export interface ChatCenterLocationMessage {
  action?: "focus" | "route";
  category?: string;
  featureId?: string;
  featureKind?: "feature" | "place" | "track";
  label?: string;
  layerId?: string;
  lat: number;
  lon: number;
  sourceName?: string;
  sourceSystemIds?: string[];
  type: typeof chatBridgeMessageTypes.centerLocation;
  zoom?: number;
}

export interface ChatCurrentLocationPayload {
  accuracyM?: number;
  label?: string;
  lat: number;
  lon: number;
  source?: "device" | "map";
  updatedAt?: string;
}

export interface ChatCurrentLocationMessage {
  location: ChatCurrentLocationPayload;
  type: typeof chatBridgeMessageTypes.currentLocation;
}

export const copMapFocusSearchParams = {
  action: "copAction",
  category: "copCategory",
  featureId: "copFeatureId",
  featureKind: "copFeatureKind",
  label: "copLabel",
  layerId: "copLayerId",
  lat: "copLat",
  lon: "copLon",
  sourceName: "copSourceName",
  sourceSystemIds: "copSourceSystemIds",
  zoom: "copZoom"
} as const;

export interface ChatSelectMessage {
  selection: string;
  type: typeof chatBridgeMessageTypes.select;
}

export interface ChatTransitSharePayload {
  detailUrl?: string;
  destination?: string;
  featureId: string;
  label?: string;
  lat?: number;
  lon?: number;
  nextStopName?: string;
  observedAt?: string;
  operator?: string;
  routeShortName?: string;
  sourceId?: string;
  status?: string;
  transportMode?: string;
  vehicleId?: string;
  warnings?: string[];
}

export interface ChatShareTransitMessage {
  at: number;
  transit: ChatTransitSharePayload;
  type: typeof chatBridgeMessageTypes.shareTransit;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clampUnreadCount(count: number): number {
  return Math.max(0, Math.trunc(count));
}

// chat → web: unread badge for the Komunikace menu.
export function encodeChatUnread(count: number): ChatUnreadMessage {
  return { at: Date.now(), count: clampUnreadCount(count), type: chatBridgeMessageTypes.unread };
}

export function decodeChatUnread(value: unknown): number | null {
  const data = asRecord(value);
  if (
    !data ||
    data.type !== chatBridgeMessageTypes.unread ||
    typeof data.count !== "number" ||
    !Number.isFinite(data.count)
  ) {
    return null;
  }
  return clampUnreadCount(data.count);
}

// chat → web: center the map on a shared location and optionally focus a map entity.
export function encodeChatCenterLocation(
  lat: number,
  lon: number,
  options: {
    action?: ChatCenterLocationMessage["action"];
    category?: string;
    featureId?: string;
    featureKind?: ChatCenterLocationMessage["featureKind"];
    label?: string;
    layerId?: string;
    sourceName?: string;
    sourceSystemIds?: string[];
    zoom?: number;
  } = {}
): ChatCenterLocationMessage {
  const normalized = normalizeCenterLocation({ lat, lon, ...options });
  if (!normalized) {
    throw new Error("COP map focus requires finite coordinates.");
  }
  return normalized;
}

function normalizeCenterLocation(value: unknown): ChatCenterLocationMessage | null {
  const data = asRecord(value);
  if (!data || typeof data.lat !== "number" || typeof data.lon !== "number" || !validLatLon(data.lat, data.lon)) {
    return null;
  }
  return compactRecord({
    action: normalizeCenterAction(data.action),
    category: normalizeBridgeText(data.category, 120),
    featureId: normalizeBridgeText(data.featureId, 160),
    featureKind: normalizeCenterFeatureKind(data.featureKind),
    label: normalizeBridgeText(data.label, 180),
    layerId: normalizeBridgeText(data.layerId, 160),
    lat: data.lat,
    lon: data.lon,
    sourceName: normalizeBridgeText(data.sourceName, 160),
    sourceSystemIds: normalizeBridgeTextList(data.sourceSystemIds, 160, 16),
    type: chatBridgeMessageTypes.centerLocation,
    zoom: normalizeCenterZoom(data.zoom)
  }) as ChatCenterLocationMessage;
}

export function decodeChatCenterLocation(value: unknown): ChatCenterLocationMessage | null {
  const data = asRecord(value);
  if (!data || data.type !== chatBridgeMessageTypes.centerLocation) {
    return null;
  }
  return normalizeCenterLocation(data);
}

export function encodeCopMapFocusUrl(baseUrl: string | URL, focus: ChatCenterLocationMessage): string {
  const normalized = decodeChatCenterLocation(focus);
  if (!normalized) {
    throw new Error("COP map focus requires finite coordinates.");
  }
  const url = new URL(baseUrl.toString());
  url.searchParams.set(copMapFocusSearchParams.lat, String(normalized.lat));
  url.searchParams.set(copMapFocusSearchParams.lon, String(normalized.lon));
  if (normalized.zoom !== undefined) {
    url.searchParams.set(copMapFocusSearchParams.zoom, String(normalized.zoom));
  }
  if (normalized.action && normalized.action !== "focus") {
    url.searchParams.set(copMapFocusSearchParams.action, normalized.action);
  }
  if (normalized.category) {
    url.searchParams.set(copMapFocusSearchParams.category, normalized.category);
  }
  if (normalized.featureId) {
    url.searchParams.set(copMapFocusSearchParams.featureId, normalized.featureId);
  }
  if (normalized.featureKind) {
    url.searchParams.set(copMapFocusSearchParams.featureKind, normalized.featureKind);
  }
  if (normalized.label) {
    url.searchParams.set(copMapFocusSearchParams.label, normalized.label);
  }
  if (normalized.layerId) {
    url.searchParams.set(copMapFocusSearchParams.layerId, normalized.layerId);
  }
  if (normalized.sourceName) {
    url.searchParams.set(copMapFocusSearchParams.sourceName, normalized.sourceName);
  }
  if (normalized.sourceSystemIds?.length) {
    url.searchParams.set(copMapFocusSearchParams.sourceSystemIds, normalized.sourceSystemIds.join(","));
  }
  return url.toString();
}

export function decodeCopMapFocusSearch(search: string | URLSearchParams): ChatCenterLocationMessage | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search : `?${search}`) : search;
  if (!params.has(copMapFocusSearchParams.lat) || !params.has(copMapFocusSearchParams.lon)) {
    return null;
  }
  const lat = Number(params.get(copMapFocusSearchParams.lat));
  const lon = Number(params.get(copMapFocusSearchParams.lon));
  if (Math.abs(lat) <= nullIslandThresholdDeg && Math.abs(lon) <= nullIslandThresholdDeg) {
    return null;
  }
  return decodeChatCenterLocation({
    action: params.get(copMapFocusSearchParams.action) ?? undefined,
    category: params.get(copMapFocusSearchParams.category) ?? undefined,
    featureId: params.get(copMapFocusSearchParams.featureId) ?? undefined,
    featureKind: params.get(copMapFocusSearchParams.featureKind) ?? undefined,
    label: params.get(copMapFocusSearchParams.label) ?? undefined,
    layerId: params.get(copMapFocusSearchParams.layerId) ?? undefined,
    lat,
    lon,
    sourceName: params.get(copMapFocusSearchParams.sourceName) ?? undefined,
    sourceSystemIds: params.get(copMapFocusSearchParams.sourceSystemIds)?.split(",") ?? undefined,
    type: chatBridgeMessageTypes.centerLocation,
    zoom: params.has(copMapFocusSearchParams.zoom) ? Number(params.get(copMapFocusSearchParams.zoom)) : undefined
  });
}

// web → chat: provide the host map/user location as AI geo context.
export function encodeChatCurrentLocation(location: ChatCurrentLocationPayload): ChatCurrentLocationMessage {
  const normalized = normalizeCurrentLocation(location);
  if (!normalized) {
    throw new Error("Current location requires finite coordinates.");
  }
  return {
    location: normalized,
    type: chatBridgeMessageTypes.currentLocation
  };
}

export function decodeChatCurrentLocation(value: unknown): ChatCurrentLocationPayload | null {
  const data = asRecord(value);
  if (!data || data.type !== chatBridgeMessageTypes.currentLocation) {
    return null;
  }
  return normalizeCurrentLocation(data.location);
}

// web → chat: open a specific conversation in the embedded chat.
export function encodeChatSelect(selection: string): ChatSelectMessage {
  return { selection, type: chatBridgeMessageTypes.select };
}

export function decodeChatSelect(value: unknown): string | null {
  const data = asRecord(value);
  if (!data || data.type !== chatBridgeMessageTypes.select || typeof data.selection !== "string") {
    return null;
  }
  const selection = data.selection.trim();
  return selection || null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function optionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return values.length ? values : undefined;
}

function normalizeTransitShare(value: unknown): ChatTransitSharePayload | null {
  const data = asRecord(value);
  const featureId = optionalString(data?.featureId);
  if (!data || !featureId) {
    return null;
  }
  return {
    ...(optionalString(data.detailUrl) ? { detailUrl: optionalString(data.detailUrl) } : {}),
    ...(optionalString(data.destination) ? { destination: optionalString(data.destination) } : {}),
    featureId,
    ...(optionalString(data.label) ? { label: optionalString(data.label) } : {}),
    ...(optionalNumber(data.lat) !== undefined ? { lat: optionalNumber(data.lat) } : {}),
    ...(optionalNumber(data.lon) !== undefined ? { lon: optionalNumber(data.lon) } : {}),
    ...(optionalString(data.nextStopName) ? { nextStopName: optionalString(data.nextStopName) } : {}),
    ...(optionalString(data.observedAt) ? { observedAt: optionalString(data.observedAt) } : {}),
    ...(optionalString(data.operator) ? { operator: optionalString(data.operator) } : {}),
    ...(optionalString(data.routeShortName) ? { routeShortName: optionalString(data.routeShortName) } : {}),
    ...(optionalString(data.sourceId) ? { sourceId: optionalString(data.sourceId) } : {}),
    ...(optionalString(data.status) ? { status: optionalString(data.status) } : {}),
    ...(optionalString(data.transportMode) ? { transportMode: optionalString(data.transportMode) } : {}),
    ...(optionalString(data.vehicleId) ? { vehicleId: optionalString(data.vehicleId) } : {}),
    ...(optionalStringList(data.warnings) ? { warnings: optionalStringList(data.warnings) } : {})
  };
}

function normalizeCenterFeatureKind(value: unknown): ChatCenterLocationMessage["featureKind"] | undefined {
  return value === "feature" || value === "place" || value === "track" ? value : undefined;
}

function normalizeCenterAction(value: unknown): ChatCenterLocationMessage["action"] | undefined {
  return value === "route" ? "route" : value === "focus" ? "focus" : undefined;
}

function normalizeCurrentLocation(value: unknown): ChatCurrentLocationPayload | null {
  const data = asRecord(value);
  if (!data || typeof data.lat !== "number" || typeof data.lon !== "number" || !validLatLon(data.lat, data.lon)) {
    return null;
  }
  return compactRecord({
    accuracyM: optionalNumber(data.accuracyM),
    label: normalizeBridgeText(data.label, 120),
    lat: data.lat,
    lon: data.lon,
    source: data.source === "device" || data.source === "map" ? data.source : undefined,
    updatedAt: normalizeBridgeText(data.updatedAt, 64)
  }) as ChatCurrentLocationPayload;
}

function normalizeCenterZoom(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(20, Math.max(3, value));
}

function normalizeBridgeText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, maxLength) : undefined;
}

function normalizeBridgeTextList(value: unknown, maxLength: number, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = Array.from(
    new Set(
      value.flatMap((item) => {
        const normalized = normalizeBridgeText(item, maxLength);
        return normalized ? [normalized] : [];
      })
    )
  ).slice(0, maxItems);
  return values.length > 0 ? values : undefined;
}

function compactRecord<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

// web → chat: send a normalized public-transit card into the active conversation.
export function encodeChatShareTransit(transit: ChatTransitSharePayload): ChatShareTransitMessage {
  const normalized = normalizeTransitShare(transit);
  if (!normalized) {
    throw new Error("Transit share requires featureId.");
  }
  return { at: Date.now(), transit: normalized, type: chatBridgeMessageTypes.shareTransit };
}

export function decodeChatShareTransit(value: unknown): ChatTransitSharePayload | null {
  const data = asRecord(value);
  if (!data || data.type !== chatBridgeMessageTypes.shareTransit) {
    return null;
  }
  return normalizeTransitShare(data.transit);
}
