// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readCopOfflineSnapshot,
  readCopOfflineSnapshotAsync,
  requestCopPersistentStorage,
  requestCopPwaCacheWarmup,
  snapshotAgeSeconds,
  writeCopOfflineSnapshot,
  writeCopOfflineSnapshotAsync
} from "./pwa-offline";
import type { CopDashboardData } from "./cop-data";

let localStorageData: Map<string, string>;

beforeEach(() => {
  localStorageData = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => localStorageData.clear(),
      getItem: (key: string) => localStorageData.get(key) ?? null,
      removeItem: (key: string) => localStorageData.delete(key),
      setItem: (key: string, value: string) => localStorageData.set(key, value)
    }
  });
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: undefined
  });
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("PWA offline snapshot", () => {
  it("stores and reads the last COP dashboard snapshot per operator scope", () => {
    const snapshot = writeCopOfflineSnapshot(sampleDashboardData(), "operator-one", "2026-05-19T08:00:00.000Z");

    expect(snapshot?.objectCount).toBe(1);
    expect(readCopOfflineSnapshot("other-operator")).toBeNull();

    const restored = readCopOfflineSnapshot("operator-one");
    expect(restored?.savedAt).toBe("2026-05-19T08:00:00.000Z");
    expect(restored?.sourceCount).toBe(1);
    expect(restored?.data.objects[0]?.objectId).toBe("AIR_SIM_UAV-0001");
    expect(restored?.data.trackHistory?.["AIR_SIM_UAV-0001"]?.[0]?.lat).toBe(50.1);
  });

  it("uses the local snapshot as the async fallback when IndexedDB is unavailable", async () => {
    const snapshot = await writeCopOfflineSnapshotAsync(
      sampleDashboardData(),
      "operator-one",
      "2026-05-19T08:00:00.000Z"
    );

    expect(snapshot?.objectCount).toBe(1);
    expect((await readCopOfflineSnapshotAsync("operator-one"))?.data.objects[0]?.objectId).toBe("AIR_SIM_UAV-0001");
  });

  it("returns null for invalid cached payloads", () => {
    window.localStorage.setItem(
      "cop.offline.snapshot.v1.lab",
      JSON.stringify({ version: 1, savedAt: "bad", data: { objects: [] } })
    );

    expect(readCopOfflineSnapshot("lab")).toBeNull();
  });

  it("reports snapshot age in seconds", () => {
    expect(snapshotAgeSeconds({ savedAt: "2026-05-19T08:00:00.000Z" }, new Date("2026-05-19T08:00:45.000Z"))).toBe(45);
  });

  it("asks the active service worker to warm the PWA cache", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          active: { postMessage }
        })
      }
    });

    requestCopPwaCacheWarmup();
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith({ type: "cop:pwa:warm-cache" });
  });

  it("requests persistent browser storage when the API is available", async () => {
    const persist = vi.fn(async () => true);
    const persisted = vi.fn(async () => false);
    const estimate = vi.fn(async () => ({ quota: 1024 * 1024 * 1024, usage: 2 * 1024 * 1024 }));
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate, persist, persisted }
    });

    await expect(requestCopPersistentStorage()).resolves.toMatchObject({
      kind: "persisted",
      quotaBytes: 1024 * 1024 * 1024,
      usageBytes: 2 * 1024 * 1024
    });
    expect(persist).toHaveBeenCalled();
  });
});

function sampleDashboardData(): CopDashboardData {
  return {
    alerts: [],
    health: {
      status: "ok",
      timestamp: "2026-05-19T08:00:00.000Z"
    },
    objects: [
      {
        affiliation: "FRIEND",
        confidence: 0.91,
        domain: "AIR",
        objectId: "AIR_SIM_UAV-0001",
        objectType: "UAV",
        position: {
          lat: 50.1,
          lon: 14.4
        },
        status: "ACTIVE",
        synthetic: true
      }
    ],
    sourceHealth: [],
    sources: [
      {
        displayName: "COP Air Situation Simulator",
        sourceSystemId: "sim-air-situation-001",
        sourceType: "SIMULATOR",
        status: "ACTIVE",
        synthetic: true
      }
    ],
    trackHistory: {
      "AIR_SIM_UAV-0001": [
        {
          affiliation: "FRIEND",
          lat: 50.1,
          lon: 14.4,
          objectId: "AIR_SIM_UAV-0001",
          timestamp: "2026-05-19T08:00:00.000Z"
        }
      ]
    }
  };
}
