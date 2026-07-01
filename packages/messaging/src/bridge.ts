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
  select: "cop-chat:select",
  shareTransit: "cop-chat:share-transit",
  unread: "cop-chat:unread"
} as const;

export const chatBridgeChannelName = "cop-chat";
export const chatUnreadStorageKey = "cop.chat.unread.v1";

export interface ChatUnreadMessage {
  at: number;
  count: number;
  type: typeof chatBridgeMessageTypes.unread;
}

export interface ChatCenterLocationMessage {
  lat: number;
  lon: number;
  type: typeof chatBridgeMessageTypes.centerLocation;
}

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
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
  if (!data || data.type !== chatBridgeMessageTypes.unread || typeof data.count !== "number" || !Number.isFinite(data.count)) {
    return null;
  }
  return clampUnreadCount(data.count);
}

// chat → web: center the map on a shared location.
export function encodeChatCenterLocation(lat: number, lon: number): ChatCenterLocationMessage {
  return { lat, lon, type: chatBridgeMessageTypes.centerLocation };
}

export function decodeChatCenterLocation(value: unknown): { lat: number; lon: number } | null {
  const data = asRecord(value);
  if (
    !data
    || data.type !== chatBridgeMessageTypes.centerLocation
    || typeof data.lat !== "number"
    || typeof data.lon !== "number"
    || !Number.isFinite(data.lat)
    || !Number.isFinite(data.lon)
  ) {
    return null;
  }
  return { lat: data.lat, lon: data.lon };
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

function optionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
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
