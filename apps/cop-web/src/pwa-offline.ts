import type { CopDashboardData } from "./cop-data";

const snapshotKey = "cop.offline.snapshot.v1";
const snapshotVersion = 1;

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

export function registerCopServiceWorker(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return;
  }
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/cop-service-worker.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        void registration.update().catch(() => undefined);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            void registration.update().catch(() => undefined);
          }
        });
      })
      .catch(() => {
        // The app must remain usable even when a browser or policy blocks service workers.
      });
  });
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

export function writeCopOfflineSnapshot(
  data: CopDashboardData,
  scope?: string,
  savedAt = new Date().toISOString()
): CopOfflineSnapshot | null {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return null;
  }

  const snapshot: CopOfflineSnapshot = {
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

  try {
    window.localStorage.setItem(scopedStorageKey(snapshotKey, scope), JSON.stringify(snapshot));
    return snapshot;
  } catch {
    return null;
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
