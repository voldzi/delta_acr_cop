import type { MessagingBootstrapResponse } from "../cop-data";
import type { MatrixMessagingSession, MatrixRoomSummary, MatrixTimelineMessage } from "./types";

interface MatrixClientLike {
  createRoom?: (options: Record<string, unknown>) => Promise<{ room_id?: string; roomId?: string }>;
  getRooms?: () => unknown[];
  getUserId?: () => string | null;
  initRustCrypto?: (args?: { cryptoDatabasePrefix?: string }) => Promise<void>;
  isRoomEncrypted?: (roomId: string) => boolean;
  joinRoom?: (roomIdOrAlias: string) => Promise<{ room_id?: string; roomId?: string }>;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  sendTextMessage?: (roomId: string, body: string) => Promise<unknown>;
  startClient?: (options?: Record<string, unknown>) => Promise<void> | void;
  stopClient?: () => void;
}

interface MatrixRoomLike {
  getMyMembership?: () => string;
  getUnreadNotificationCount?: () => number;
  name?: string;
  roomId?: string;
  timeline?: unknown[];
}

interface MatrixEventLike {
  getContent?: () => Record<string, unknown>;
  getId?: () => string | undefined;
  getRoomId?: () => string | undefined;
  getSender?: () => string | undefined;
  getTs?: () => number | undefined;
  getType?: () => string | undefined;
}

export async function createMatrixMessagingSession(
  bootstrap: MessagingBootstrapResponse,
  callbacks: {
    onRoomsChanged?: (rooms: MatrixRoomSummary[]) => void;
    onSyncState?: (state: string) => void;
  } = {}
): Promise<MatrixMessagingSession> {
  validateBootstrap(bootstrap);
  const homeserverBaseUrl = bootstrap.homeserverBaseUrl;
  if (!homeserverBaseUrl) {
    throw new Error("Matrix bootstrap neobsahuje URL homeserveru.");
  }
  await assertBrowserCanReachHomeserver(homeserverBaseUrl);
  const matrixSdk = await import("matrix-js-sdk/lib/browser-index.js");
  const createClient = (matrixSdk as unknown as { createClient: (options: Record<string, unknown>) => MatrixClientLike }).createClient;
  const client = createClient({
    accessToken: bootstrap.accessToken,
    baseUrl: homeserverBaseUrl,
    deviceId: bootstrap.deviceId,
    userId: bootstrap.userId
  });

  if (bootstrap.e2eeRequired) {
    if (typeof client.initRustCrypto !== "function") {
      throw new Error("Matrix klient nepodporuje Rust Crypto. E2EE chat zůstává vypnutý.");
    }
    try {
      await client.initRustCrypto({
        cryptoDatabasePrefix: matrixCryptoDatabasePrefix(bootstrap)
      });
    } catch (caught) {
      if (isMatrixAccountStoreMismatch(caught)) {
        throw new MatrixAccountStoreMismatchError(caught);
      }
      throw caught;
    }
  }

  let inviteJoinInFlight: Promise<void> | null = null;
  const joinInvitedRooms = async () => {
    if (inviteJoinInFlight) {
      return inviteJoinInFlight;
    }
    inviteJoinInFlight = joinInvitedRoomsOnce(client, homeserverBaseUrl)
      .finally(() => {
        inviteJoinInFlight = null;
      });
    return inviteJoinInFlight;
  };

  const syncListener = (state: unknown) => {
    callbacks.onSyncState?.(typeof state === "string" ? state : "sync");
    void joinInvitedRooms().then(() => callbacks.onRoomsChanged?.(readRooms(client)));
    callbacks.onRoomsChanged?.(readRooms(client));
  };
  const timelineListener = () => {
    callbacks.onRoomsChanged?.(readRooms(client));
  };
  client.on?.("sync", syncListener);
  client.on?.("Room.timeline", timelineListener);
  await client.startClient?.({ initialSyncLimit: 30 });
  await joinInvitedRooms();
  callbacks.onRoomsChanged?.(readRooms(client));

  return {
    bootstrap,
    createGroupRoom: async (name, inviteUserIds = []) => {
      if (typeof client.createRoom !== "function") {
        throw new Error("Matrix SDK neumí založit konverzaci.");
      }
      let response: { room_id?: string; roomId?: string };
      try {
        response = await client.createRoom({
          invite: inviteUserIds,
          initial_state: bootstrap.e2eeRequired ? [{
            content: {
              algorithm: "m.megolm.v1.aes-sha2"
            },
            state_key: "",
            type: "m.room.encryption"
          }] : [],
          name,
          preset: inviteUserIds.length > 0 ? "private_chat" : "trusted_private_chat",
          visibility: "private"
        });
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "založit chatovou místnost");
      }
      callbacks.onRoomsChanged?.(readRooms(client));
      const roomId = response.room_id ?? response.roomId;
      if (!roomId) {
        throw new Error("Matrix nevrátil identifikátor konverzace.");
      }
      return roomId;
    },
    getRooms: () => readRooms(client),
    getTimeline: (roomId) => readTimeline(client, roomId),
    joinInvitedRooms,
    sendMessage: async (roomId, body) => {
      const message = body.trim();
      if (!message) {
        return;
      }
      if (typeof client.sendTextMessage !== "function") {
        throw new Error("Matrix SDK neumí odeslat textovou zprávu.");
      }
      try {
        await joinInvitedRooms();
        await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
        await client.sendTextMessage(roomId, message);
      } catch (caught) {
        throw formatMatrixClientError(caught, homeserverBaseUrl, "odeslat zprávu");
      }
    },
    stop: () => {
      client.off?.("sync", syncListener);
      client.off?.("Room.timeline", timelineListener);
      client.stopClient?.();
    }
  };
}

export class MatrixAccountStoreMismatchError extends Error {
  constructor(readonly cause: unknown) {
    super("Lokální šifrovací úložiště patří jinému účtu. Chat se bezpečně obnoví pro aktuálně přihlášeného uživatele.");
    this.name = "MatrixAccountStoreMismatchError";
  }
}

export function isMatrixAccountStoreMismatchError(caught: unknown): caught is MatrixAccountStoreMismatchError {
  return caught instanceof MatrixAccountStoreMismatchError;
}

function matrixCryptoDatabasePrefix(bootstrap: MessagingBootstrapResponse): string {
  const identity = `${bootstrap.userId}.${bootstrap.deviceId}`;
  return `cop-web-matrix-${identity
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._=-]+/gu, "_")
    .slice(0, 140)}`;
}

async function joinInvitedRoomsOnce(client: MatrixClientLike, homeserverBaseUrl: string): Promise<void> {
  const invitedRoomIds = (client.getRooms?.() ?? [])
    .map(asRoom)
    .filter((room): room is MatrixRoomLike & { roomId: string } => Boolean(room?.roomId && room.getMyMembership?.() === "invite"))
    .map((room) => room.roomId);

  for (const roomId of invitedRoomIds) {
    await ensureJoinedRoom(client, roomId, homeserverBaseUrl);
  }
}

async function ensureJoinedRoom(client: MatrixClientLike, roomId: string, homeserverBaseUrl: string): Promise<void> {
  const room = (client.getRooms?.() ?? []).map(asRoom).find((candidate) => candidate?.roomId === roomId);
  if (room?.getMyMembership?.() !== "invite") {
    return;
  }
  if (typeof client.joinRoom !== "function") {
    throw new Error("Matrix SDK neumí přijmout pozvánku do konverzace.");
  }
  try {
    await client.joinRoom(roomId);
  } catch (caught) {
    throw formatMatrixClientError(caught, homeserverBaseUrl, "přijmout pozvánku do konverzace");
  }
}

export async function clearMatrixMessagingDeviceState(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const keysToRemove = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith("cop.messaging.matrixDeviceId")));
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Best effort cleanup only. Matrix SDK owns the crypto store lifecycle.
  }
  const indexedDb = window.indexedDB;
  const databases = typeof indexedDb?.databases === "function" ? await indexedDb.databases() : [];
  await Promise.all(databases
    .map((database) => database.name)
    .filter((name): name is string => Boolean(name && /matrix|crypto|olm/iu.test(name)))
    .map((name) => new Promise<void>((resolve) => {
      const request = indexedDb.deleteDatabase(name);
      request.onerror = () => resolve();
      request.onsuccess = () => resolve();
      request.onblocked = () => resolve();
    })));
}

function validateBootstrap(bootstrap: MessagingBootstrapResponse): void {
  if (!bootstrap.chatAvailable || !bootstrap.tokenAvailable || !bootstrap.accessToken) {
    throw new Error("Matrix bootstrap neobsahuje uživatelský access token.");
  }
  if (!bootstrap.homeserverBaseUrl || !bootstrap.userId || !bootstrap.deviceId) {
    throw new Error("Matrix bootstrap neobsahuje povinné údaje klienta.");
  }
  if (bootstrap.e2eeRequired !== true) {
    throw new Error("Provider nevyžaduje E2EE; COP chat proto zůstává vypnutý.");
  }
}

async function assertBrowserCanReachHomeserver(baseUrl: string): Promise<void> {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  const versionsUrl = `${baseUrl.replace(/\/+$/u, "")}/_matrix/client/versions`;
  try {
    const response = await window.fetch(versionsUrl, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (caught) {
    throw formatMatrixClientError(caught, baseUrl, "ověřit Matrix server v prohlížeči");
  }
}

export function formatMatrixClientError(caught: unknown, baseUrl: string, action: string): Error {
  if (isLikelyBrowserNetworkError(caught)) {
    return new Error(
      `Nelze ${action}: prohlížeč se nedostal na Matrix server ${baseUrl}. ` +
      `Otevřete ${baseUrl.replace(/\/+$/u, "")}/_matrix/client/versions na stejném zařízení; ` +
      "pokud endpoint funguje, proveďte tvrdé obnovení stránky nebo vyčistěte DNS/site cache pro cop.zeleznalady.cz a msg.zeleznalady.cz."
    );
  }
  return caught instanceof Error ? caught : new Error(`Nelze ${action}: ${String(caught)}`);
}

function isMatrixAccountStoreMismatch(caught: unknown): boolean {
  if (!(caught instanceof Error)) {
    return false;
  }
  const message = caught.message.toLowerCase();
  return message.includes("account in the store doesn't match the account in the constructor") ||
    message.includes("account in the store does not match the account in the constructor");
}

function isLikelyBrowserNetworkError(caught: unknown): boolean {
  if (!(caught instanceof Error)) {
    return false;
  }
  const message = caught.message.toLowerCase();
  return (
    caught.name === "ConnectionError" ||
    message.includes("fetch failed") ||
    message.includes("load failed") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network error")
  );
}

function readRooms(client: MatrixClientLike): MatrixRoomSummary[] {
  return (client.getRooms?.() ?? [])
    .map(asRoom)
    .filter((room): room is MatrixRoomLike & { roomId: string } => Boolean(room?.roomId))
    .map((room) => ({
      encrypted: Boolean(client.isRoomEncrypted?.(room.roomId)),
      name: room.name?.trim() || room.roomId,
      roomId: room.roomId,
      unreadCount: Math.max(0, room.getUnreadNotificationCount?.() ?? 0)
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "cs"));
}

function readTimeline(client: MatrixClientLike, roomId: string): MatrixTimelineMessage[] {
  const room = (client.getRooms?.() ?? []).map(asRoom).find((candidate) => candidate?.roomId === roomId);
  const currentUserId = client.getUserId?.() ?? undefined;
  return (room?.timeline ?? [])
    .map(asEvent)
    .filter((event): event is MatrixEventLike => Boolean(event && event.getType?.() === "m.room.message"))
    .flatMap((event) => {
      const content = event.getContent?.() ?? {};
      const body = typeof content.body === "string" ? content.body.trim() : "";
      if (!body) {
        return [];
      }
      const sender = event.getSender?.() ?? "";
      return [{
        body,
        eventId: event.getId?.() ?? `${sender}-${event.getTs?.() ?? Date.now()}`,
        own: Boolean(currentUserId && sender === currentUserId),
        sender,
        timestamp: new Date(event.getTs?.() ?? Date.now()).toISOString()
      }];
    })
    .slice(-80);
}

function asRoom(value: unknown): MatrixRoomLike | null {
  return typeof value === "object" && value !== null ? value as MatrixRoomLike : null;
}

function asEvent(value: unknown): MatrixEventLike | null {
  return typeof value === "object" && value !== null ? value as MatrixEventLike : null;
}
