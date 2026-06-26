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
