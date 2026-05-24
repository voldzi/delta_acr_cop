import type { MessagingBootstrapResponse } from "../cop-data";
import type { MatrixMessagingSession, MatrixRoomSummary, MatrixTimelineMessage } from "./types";

interface MatrixClientLike {
  createRoom?: (options: Record<string, unknown>) => Promise<{ room_id?: string; roomId?: string }>;
  getRooms?: () => unknown[];
  getUserId?: () => string | null;
  initRustCrypto?: () => Promise<void>;
  isRoomEncrypted?: (roomId: string) => boolean;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  sendTextMessage?: (roomId: string, body: string) => Promise<unknown>;
  startClient?: (options?: Record<string, unknown>) => Promise<void> | void;
  stopClient?: () => void;
}

interface MatrixRoomLike {
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
  const matrixSdk = await import("matrix-js-sdk");
  const createClient = (matrixSdk as unknown as { createClient: (options: Record<string, unknown>) => MatrixClientLike }).createClient;
  const client = createClient({
    accessToken: bootstrap.accessToken,
    baseUrl: bootstrap.homeserverBaseUrl,
    deviceId: bootstrap.deviceId,
    userId: bootstrap.userId
  });

  if (bootstrap.e2eeRequired) {
    if (typeof client.initRustCrypto !== "function") {
      throw new Error("Matrix klient nepodporuje Rust Crypto. E2EE chat zůstává vypnutý.");
    }
    await client.initRustCrypto();
  }

  const syncListener = (state: unknown) => {
    callbacks.onSyncState?.(typeof state === "string" ? state : "sync");
    callbacks.onRoomsChanged?.(readRooms(client));
  };
  const timelineListener = () => {
    callbacks.onRoomsChanged?.(readRooms(client));
  };
  client.on?.("sync", syncListener);
  client.on?.("Room.timeline", timelineListener);
  await client.startClient?.({ initialSyncLimit: 30 });
  callbacks.onRoomsChanged?.(readRooms(client));

  return {
    bootstrap,
    createGroupRoom: async (name, inviteUserIds = []) => {
      if (typeof client.createRoom !== "function") {
        throw new Error("Matrix SDK neumí založit konverzaci.");
      }
      const response = await client.createRoom({
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
      callbacks.onRoomsChanged?.(readRooms(client));
      const roomId = response.room_id ?? response.roomId;
      if (!roomId) {
        throw new Error("Matrix nevrátil identifikátor konverzace.");
      }
      return roomId;
    },
    getRooms: () => readRooms(client),
    getTimeline: (roomId) => readTimeline(client, roomId),
    sendMessage: async (roomId, body) => {
      const message = body.trim();
      if (!message) {
        return;
      }
      if (typeof client.sendTextMessage !== "function") {
        throw new Error("Matrix SDK neumí odeslat textovou zprávu.");
      }
      await client.sendTextMessage(roomId, message);
    },
    stop: () => {
      client.off?.("sync", syncListener);
      client.off?.("Room.timeline", timelineListener);
      client.stopClient?.();
    }
  };
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
