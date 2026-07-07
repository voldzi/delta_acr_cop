import type { MatrixTimelineMessage } from "@cop/messaging/types";
import { selectReadableTimelineMessagesForStorage } from "./chat-model";

const timelineCacheDatabaseName = "cop-chat-timeline-cache-v1";
const timelineCacheDatabaseVersion = 1;
const timelineCacheStoreName = "messages";
const timelineCacheStoragePrefix = "cop.chat.timelineCache.v1";
const maxStoredTimelineMessagesPerRoom = 500;

interface StoredTimelineCacheRecord {
  cacheKey: string;
  eventId: string;
  message: MatrixTimelineMessage;
  ownerKey: string;
  roomId: string;
  roomKey: string;
  timestampMs: number;
  updatedAtMs: number;
}

let timelineCacheDatabasePromise: Promise<IDBDatabase> | null = null;

export async function readStoredRoomTimeline(ownerId: string, roomId: string): Promise<MatrixTimelineMessage[]> {
  if (!roomId) {
    return [];
  }
  try {
    const database = await openTimelineCacheDatabase();
    const roomKey = timelineRoomKey(ownerId, roomId);
    const transaction = database.transaction(timelineCacheStoreName, "readonly");
    const records = await idbRequestToPromise<StoredTimelineCacheRecord[]>(
      transaction.objectStore(timelineCacheStoreName).index("roomKey").getAll(IDBKeyRange.only(roomKey))
    );
    return normalizeStoredTimeline(records.map((record) => record.message));
  } catch {
    return readStoredRoomTimelineFromLocalStorage(ownerId, roomId);
  }
}

export async function writeStoredRoomTimeline(
  ownerId: string,
  roomId: string,
  messages: MatrixTimelineMessage[]
): Promise<void> {
  const readableMessages = normalizeStoredTimeline(messages);
  if (readableMessages.length === 0) {
    return;
  }
  try {
    const database = await openTimelineCacheDatabase();
    await replaceIndexedDbRoomTimeline(database, ownerId, roomId, readableMessages);
    return;
  } catch {
    writeStoredRoomTimelineToLocalStorage(ownerId, roomId, readableMessages);
  }
}

export async function deleteStoredRoomTimeline(ownerId: string, roomId: string): Promise<void> {
  if (!roomId) {
    return;
  }
  try {
    const database = await openTimelineCacheDatabase();
    await deleteIndexedDbRoomTimeline(database, ownerId, roomId);
  } catch {
    // IndexedDB is best-effort. The localStorage fallback below is the important cleanup path in restricted contexts.
  }
  try {
    window.localStorage.removeItem(localStorageTimelineKey(ownerId, roomId));
  } catch {
    // Persistent timeline cache cleanup must never break chat UI.
  }
}

function normalizeStoredTimeline(messages: MatrixTimelineMessage[]): MatrixTimelineMessage[] {
  return selectReadableTimelineMessagesForStorage(messages, maxStoredTimelineMessagesPerRoom);
}

async function replaceIndexedDbRoomTimeline(
  database: IDBDatabase,
  ownerId: string,
  roomId: string,
  messages: MatrixTimelineMessage[]
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ownerKey = stableTimelineStoragePart(ownerId);
    const roomKey = timelineRoomKey(ownerId, roomId);
    const transaction = database.transaction(timelineCacheStoreName, "readwrite");
    const store = transaction.objectStore(timelineCacheStoreName);
    const existingKeysRequest = store.index("roomKey").getAllKeys(IDBKeyRange.only(roomKey));
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Timeline cache transaction was aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Timeline cache transaction failed."));
    existingKeysRequest.onerror = () =>
      reject(existingKeysRequest.error ?? new Error("Timeline cache keys could not be read."));
    existingKeysRequest.onsuccess = () => {
      const nextKeys = new Set(messages.map((message) => timelineMessageCacheKey(ownerKey, roomId, message.eventId)));
      for (const existingKey of existingKeysRequest.result) {
        if (typeof existingKey === "string" && !nextKeys.has(existingKey)) {
          store.delete(existingKey);
        }
      }
      const updatedAtMs = Date.now();
      for (const message of messages) {
        const cacheKey = timelineMessageCacheKey(ownerKey, roomId, message.eventId);
        store.put({
          cacheKey,
          eventId: message.eventId,
          message,
          ownerKey,
          roomId,
          roomKey,
          timestampMs: finiteTimestampMs(message.timestamp),
          updatedAtMs
        } satisfies StoredTimelineCacheRecord);
      }
    };
  });
}

async function deleteIndexedDbRoomTimeline(database: IDBDatabase, ownerId: string, roomId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const roomKey = timelineRoomKey(ownerId, roomId);
    const transaction = database.transaction(timelineCacheStoreName, "readwrite");
    const store = transaction.objectStore(timelineCacheStoreName);
    const keysRequest = store.index("roomKey").getAllKeys(IDBKeyRange.only(roomKey));
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Timeline cache cleanup was aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Timeline cache cleanup failed."));
    keysRequest.onerror = () => reject(keysRequest.error ?? new Error("Timeline cache keys could not be read."));
    keysRequest.onsuccess = () => {
      for (const key of keysRequest.result) {
        store.delete(key);
      }
    };
  });
}

function openTimelineCacheDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is not available."));
  }
  timelineCacheDatabasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(timelineCacheDatabaseName, timelineCacheDatabaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(timelineCacheStoreName)
        ? request.transaction?.objectStore(timelineCacheStoreName)
        : database.createObjectStore(timelineCacheStoreName, { keyPath: "cacheKey" });
      if (!store) {
        return;
      }
      if (!store.indexNames.contains("roomKey")) {
        store.createIndex("roomKey", "roomKey", { unique: false });
      }
      if (!store.indexNames.contains("timestampMs")) {
        store.createIndex("timestampMs", "timestampMs", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      timelineCacheDatabasePromise = null;
      reject(request.error ?? new Error("Timeline cache database failed to open."));
    };
    request.onblocked = () => {
      timelineCacheDatabasePromise = null;
      reject(new Error("Timeline cache database upgrade is blocked."));
    };
  });
  return timelineCacheDatabasePromise;
}

function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Timeline cache request failed."));
  });
}

function readStoredRoomTimelineFromLocalStorage(ownerId: string, roomId: string): MatrixTimelineMessage[] {
  try {
    const raw = window.localStorage.getItem(localStorageTimelineKey(ownerId, roomId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return normalizeStoredTimeline(Array.isArray(parsed) ? parseTimelineMessages(parsed) : []);
  } catch {
    return [];
  }
}

function writeStoredRoomTimelineToLocalStorage(
  ownerId: string,
  roomId: string,
  messages: MatrixTimelineMessage[]
): void {
  try {
    window.localStorage.setItem(localStorageTimelineKey(ownerId, roomId), JSON.stringify(messages));
  } catch {
    // localStorage is only a fallback for browsers that deny IndexedDB.
  }
}

function parseTimelineMessages(value: unknown[]): MatrixTimelineMessage[] {
  return value.filter(isMatrixTimelineMessage);
}

function isMatrixTimelineMessage(value: unknown): value is MatrixTimelineMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<MatrixTimelineMessage>;
  return (
    typeof record.body === "string" &&
    typeof record.eventId === "string" &&
    typeof record.kind === "string" &&
    typeof record.own === "boolean" &&
    typeof record.sender === "string" &&
    typeof record.timestamp === "string"
  );
}

function localStorageTimelineKey(ownerId: string, roomId: string): string {
  return `${timelineCacheStoragePrefix}.${stableTimelineStoragePart(ownerId)}.${stableTimelineStoragePart(roomId)}`;
}

function timelineRoomKey(ownerId: string, roomId: string): string {
  return `${stableTimelineStoragePart(ownerId)}:${stableTimelineStoragePart(roomId)}`;
}

function timelineMessageCacheKey(ownerKey: string, roomId: string, eventId: string): string {
  return `${ownerKey}:${stableTimelineStoragePart(roomId)}:${stableTimelineStoragePart(eventId)}`;
}

function stableTimelineStoragePart(value: string): string {
  return encodeURIComponent(value.trim() || "unknown");
}

function finiteTimestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}
