import type { MessagingBootstrapResponse } from "./types.js";
import { chatBridgeChannelName, chatUnreadStorageKey, decodeChatUnread, encodeChatUnread } from "./bridge.js";

const matrixDeviceIdStoragePrefix = "cop.messaging.matrixDeviceId.v2";
const fallbackMatrixDeviceIds = new Map<string, string>();

export function getOrCreateMatrixDeviceId(ownerId: string): string {
  const storageKey = `${matrixDeviceIdStoragePrefix}.${stableStorageKey(ownerId)}`;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (isValidMatrixDeviceId(stored)) {
      return stored;
    }
    const next = createMatrixDeviceId();
    window.localStorage.setItem(storageKey, next);
    return next;
  } catch {
    const fallback = fallbackMatrixDeviceIds.get(storageKey) ?? createMatrixDeviceId();
    fallbackMatrixDeviceIds.set(storageKey, fallback);
    return fallback;
  }
}

export function rotateMatrixDeviceId(ownerId: string): string {
  const storageKey = `${matrixDeviceIdStoragePrefix}.${stableStorageKey(ownerId)}`;
  const next = createMatrixDeviceId();
  try {
    window.localStorage.setItem(storageKey, next);
  } catch {
    fallbackMatrixDeviceIds.set(storageKey, next);
  }
  return next;
}

export function publishChatUnreadCount(count: number): void {
  const payload = encodeChatUnread(count);
  if (window.parent !== window) {
    window.parent.postMessage(payload, window.location.origin);
  }
  try {
    window.localStorage.setItem(chatUnreadStorageKey, JSON.stringify(payload));
  } catch {
    // Same-origin host badge sync is best effort; chat must keep working when storage is blocked.
  }
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(chatBridgeChannelName);
      channel.postMessage(payload);
      channel.close();
    } catch {
      // BroadcastChannel is optional and may be blocked in private browsing modes.
    }
  }
}

export function applyChatUnreadPayload(value: unknown, onCount: (count: number) => void): boolean {
  const count = decodeChatUnread(value);
  if (count === null) {
    return false;
  }
  onCount(count);
  return true;
}

export function readStoredChatUnreadCount(): number | null {
  try {
    const stored = window.localStorage.getItem(chatUnreadStorageKey);
    let count: number | null = null;
    if (stored) {
      applyChatUnreadPayload(JSON.parse(stored) as unknown, (nextCount) => {
        count = nextCount;
      });
    }
    return count;
  } catch {
    return null;
  }
}

export async function fetchMatrixUnreadCount(
  bootstrap: MessagingBootstrapResponse,
  signal?: AbortSignal
): Promise<number> {
  if (!bootstrap.homeserverBaseUrl || !bootstrap.accessToken) {
    return 0;
  }
  const filter = {
    presence: { limit: 0 },
    room: {
      account_data: { limit: 0 },
      ephemeral: { limit: 0 },
      state: { limit: 0 },
      timeline: { limit: 0 }
    }
  };
  const params = new URLSearchParams({
    filter: JSON.stringify(filter),
    timeout: "0"
  });
  const response = await fetch(
    `${trimTrailingSlash(bootstrap.homeserverBaseUrl)}/_matrix/client/v3/sync?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${bootstrap.accessToken}` },
      signal
    }
  );
  if (!response.ok) {
    throw new Error(`Matrix unread sync failed: ${response.status}`);
  }
  const payload = (await response.json()) as MatrixSyncUnreadResponse;
  const joinedRooms = payload.rooms?.join ?? {};
  const inviteCount = Object.keys(payload.rooms?.invite ?? {}).length;
  const joinedCount = Object.values(joinedRooms).reduce((total, room) => {
    const notificationCount = Number(room?.unread_notifications?.notification_count ?? 0);
    return total + (Number.isFinite(notificationCount) ? Math.max(0, notificationCount) : 0);
  }, 0);
  return joinedCount + inviteCount;
}

interface MatrixSyncUnreadResponse {
  rooms?: {
    invite?: Record<string, unknown>;
    join?: Record<
      string,
      {
        unread_notifications?: {
          highlight_count?: number;
          notification_count?: number;
        };
      }
    >;
  };
}

function createMatrixDeviceId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.every((value) => value === 0)) {
    return `COPWEB.${Date.now().toString(36)}`;
  }
  return `COPWEB.${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function isValidMatrixDeviceId(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9._=-]{1,64}$/u.test(value));
}

function stableStorageKey(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._=-]+/gu, "_")
      .slice(0, 96) || "anonymous"
  );
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
