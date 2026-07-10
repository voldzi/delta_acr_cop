import { registerCopPwaServiceWorker } from "@cop/core/pwa-release";
import type { CopDashboardData } from "./cop-data";

const snapshotKey = "cop.offline.snapshot.v1";
const snapshotVersion = 1;
const offlineDatabaseName = "cop.offline.v1";
const offlineDatabaseVersion = 1;
const offlineSnapshotStoreName = "snapshots";

export interface CopOfflineSnapshot {
  data: CopDashboardData;
  objectCount: number;
  savedAt: string;
  sourceCount: number;
  version: typeof snapshotVersion;
}

export type CopPwaCacheState =
  | {
      appShellEntries: number;
      kind: "ready";
      runtimeEntries: number;
      tileEntries: number;
      updatedAt: string;
      warmedAssets: number;
    }
  | { error: string; kind: "error" }
  | { kind: "unknown" }
  | { kind: "warming" };

export type CopStoragePersistenceState =
  | { kind: "best-effort"; quotaBytes?: number; usageBytes?: number }
  | { error: string; kind: "error" }
  | { kind: "persisted"; quotaBytes?: number; usageBytes?: number }
  | { kind: "checking" }
  | { kind: "unknown" }
  | { kind: "unsupported" };

export interface CopRouteTileCacheWarmupRequest {
  routeId: string;
  urls: string[];
}

export function registerCopServiceWorker(): void {
  registerCopPwaServiceWorker({ enabled: import.meta.env.PROD });
}

export function requestCopPwaCacheWarmup(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  void navigator.serviceWorker.ready
    .then((registration) => {
      const worker =
        registration.active ?? registration.waiting ?? registration.installing ?? navigator.serviceWorker.controller;
      worker?.postMessage({ type: "cop:pwa:warm-cache" });
    })
    .catch(() => undefined);
}

export function requestCopRouteTileCacheWarmup(request: CopRouteTileCacheWarmupRequest): boolean {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    !request.routeId ||
    request.urls.length === 0
  ) {
    return false;
  }

  void navigator.serviceWorker.ready
    .then((registration) => {
      const worker =
        registration.active ?? registration.waiting ?? registration.installing ?? navigator.serviceWorker.controller;
      worker?.postMessage({ routeId: request.routeId, type: "cop:pwa:warm-route-tiles", urls: request.urls });
    })
    .catch(() => undefined);
  return true;
}

export function readCopOfflineSnapshot(scope?: string): CopOfflineSnapshot | null {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(scopedStorageKey(snapshotKey, scope));
    if (!raw) {
      return null;
    }
    return normalizeSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function readCopOfflineSnapshotAsync(scope?: string): Promise<CopOfflineSnapshot | null> {
  const key = scopedStorageKey(snapshotKey, scope);
  const indexedSnapshot = await readSnapshotFromIndexedDb(key);
  const localSnapshot = readCopOfflineSnapshot(scope);
  const snapshot = newestSnapshot(indexedSnapshot, localSnapshot);
  if (!localSnapshot) {
    return snapshot;
  }
  if (snapshot === indexedSnapshot || (snapshot === localSnapshot && (await writeSnapshotToIndexedDb(key, snapshot)))) {
    removeSnapshotFromLocalStorage(key);
  }
  return snapshot;
}

export function writeCopOfflineSnapshot(
  data: CopDashboardData,
  scope?: string,
  savedAt = new Date().toISOString()
): CopOfflineSnapshot | null {
  const snapshot = createCopOfflineSnapshot(data, savedAt);
  const key = scopedStorageKey(snapshotKey, scope);
  const localStored = writeSnapshotToLocalStorage(key, snapshot);
  void writeSnapshotToIndexedDb(key, snapshot).catch(() => undefined);
  return localStored ? snapshot : null;
}

export async function writeCopOfflineSnapshotAsync(
  data: CopDashboardData,
  scope?: string,
  savedAt = new Date().toISOString()
): Promise<CopOfflineSnapshot | null> {
  const snapshot = createCopOfflineSnapshot(data, savedAt);
  const key = scopedStorageKey(snapshotKey, scope);
  const indexedStored = await writeSnapshotToIndexedDb(key, snapshot);
  if (indexedStored) {
    removeSnapshotFromLocalStorage(key);
    return snapshot;
  }
  return writeSnapshotToLocalStorage(key, snapshot) ? snapshot : null;
}

export async function requestCopPersistentStorage(): Promise<CopStoragePersistenceState> {
  if (typeof navigator === "undefined" || !navigator.storage) {
    return { kind: "unsupported" };
  }
  try {
    const estimate = typeof navigator.storage.estimate === "function" ? await navigator.storage.estimate() : undefined;
    const usageBytes = optionalNonNegativeInteger(estimate?.usage);
    const quotaBytes = optionalNonNegativeInteger(estimate?.quota);
    const alreadyPersisted =
      typeof navigator.storage.persisted === "function" ? await navigator.storage.persisted() : false;
    const persisted =
      alreadyPersisted || (typeof navigator.storage.persist === "function" ? await navigator.storage.persist() : false);
    return {
      kind: persisted ? "persisted" : "best-effort",
      ...(quotaBytes !== undefined ? { quotaBytes } : {}),
      ...(usageBytes !== undefined ? { usageBytes } : {})
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Persistent storage request failed.",
      kind: "error"
    };
  }
}

export function snapshotAgeSeconds(snapshot: Pick<CopOfflineSnapshot, "savedAt">, now = new Date()): number | null {
  const savedAt = Date.parse(snapshot.savedAt);
  if (!Number.isFinite(savedAt)) {
    return null;
  }
  return Math.max(0, Math.round((now.getTime() - savedAt) / 1000));
}

function normalizeSnapshot(value: unknown): CopOfflineSnapshot | null {
  if (
    !isRecord(value) ||
    value.version !== snapshotVersion ||
    typeof value.savedAt !== "string" ||
    !Number.isFinite(Date.parse(value.savedAt)) ||
    !isRecord(value.data)
  ) {
    return null;
  }
  const data = value.data;
  if (!isRecord(data.health) || !Array.isArray(data.sources) || !Array.isArray(data.objects)) {
    return null;
  }

  return {
    data: {
      alerts: Array.isArray(data.alerts) ? data.alerts : [],
      health: data.health as unknown as CopDashboardData["health"],
      objects: data.objects as CopDashboardData["objects"],
      sourceHealth: Array.isArray(data.sourceHealth) ? (data.sourceHealth as CopDashboardData["sourceHealth"]) : [],
      sources: data.sources as CopDashboardData["sources"],
      streamHealth: isRecord(data.streamHealth)
        ? (data.streamHealth as unknown as CopDashboardData["streamHealth"])
        : undefined,
      trackHistory: isRecord(data.trackHistory) ? (data.trackHistory as CopDashboardData["trackHistory"]) : undefined
    },
    objectCount: optionalNonNegativeInteger(value.objectCount) ?? data.objects.length,
    savedAt: value.savedAt,
    sourceCount: optionalNonNegativeInteger(value.sourceCount) ?? data.sources.length,
    version: snapshotVersion
  };
}

function newestSnapshot(
  first: CopOfflineSnapshot | null,
  second: CopOfflineSnapshot | null
): CopOfflineSnapshot | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  const firstSavedAt = Date.parse(first.savedAt);
  const secondSavedAt = Date.parse(second.savedAt);
  if (!Number.isFinite(firstSavedAt)) {
    return second;
  }
  if (!Number.isFinite(secondSavedAt)) {
    return first;
  }
  return secondSavedAt > firstSavedAt ? second : first;
}

function createCopOfflineSnapshot(data: CopDashboardData, savedAt: string): CopOfflineSnapshot {
  return {
    data: {
      alerts: Array.isArray(data.alerts) ? data.alerts : [],
      health: data.health,
      objects: Array.isArray(data.objects) ? data.objects : [],
      sourceHealth: Array.isArray(data.sourceHealth) ? data.sourceHealth : [],
      sources: Array.isArray(data.sources) ? data.sources : [],
      streamHealth: data.streamHealth,
      trackHistory: data.trackHistory
    },
    objectCount: data.objects.length,
    savedAt,
    sourceCount: data.sources.length,
    version: snapshotVersion
  };
}

function writeSnapshotToLocalStorage(key: string, snapshot: CopOfflineSnapshot): boolean {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return false;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

function removeSnapshotFromLocalStorage(key: string): void {
  if (typeof window === "undefined" || typeof window.localStorage?.removeItem !== "function") {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage cleanup is best-effort; the IndexedDB snapshot remains authoritative.
  }
}

async function readSnapshotFromIndexedDb(key: string): Promise<CopOfflineSnapshot | null> {
  const db = await openOfflineDatabase();
  if (!db) {
    return null;
  }
  try {
    const transaction = db.transaction(offlineSnapshotStoreName, "readonly");
    const value = await requestToPromise<unknown>(transaction.objectStore(offlineSnapshotStoreName).get(key));
    if (!isRecord(value)) {
      return null;
    }
    return normalizeSnapshot(value.snapshot);
  } catch {
    return null;
  }
}

async function writeSnapshotToIndexedDb(key: string, snapshot: CopOfflineSnapshot): Promise<boolean> {
  const db = await openOfflineDatabase();
  if (!db) {
    return false;
  }
  try {
    const transaction = db.transaction(offlineSnapshotStoreName, "readwrite");
    transaction.objectStore(offlineSnapshotStoreName).put({
      key,
      snapshot,
      updatedAt: new Date().toISOString()
    });
    await transactionToPromise(transaction);
    return true;
  } catch {
    return false;
  }
}

let offlineDatabasePromise: Promise<IDBDatabase | null> | null = null;

function openOfflineDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  offlineDatabasePromise ??= new Promise((resolve) => {
    const request = indexedDB.open(offlineDatabaseName, offlineDatabaseVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(offlineSnapshotStoreName)) {
        db.createObjectStore(offlineSnapshotStoreName, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return offlineDatabasePromise.then((database) => {
    if (!database) {
      offlineDatabasePromise = null;
    }
    return database;
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? Math.trunc(numericValue) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopedStorageKey(baseKey: string, scope: string | undefined): string {
  const normalizedScope = normalizeStorageScope(scope);
  return normalizedScope ? `${baseKey}.${normalizedScope}` : baseKey;
}

function normalizeStorageScope(scope: string | undefined): string {
  if (!scope) {
    return "";
  }
  return scope
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
