// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { clamp, normalizeMapView, readUserPreferences, writeUserPreferences } from "./user-preferences";

beforeEach(() => {
  installLocalStorageMock();
});

describe("user preferences helpers", () => {
  it("normalizes persisted map view", () => {
    expect(normalizeMapView({ center: [14.4, 50.1], zoom: 9 })).toEqual({
      center: [14.4, 50.1],
      zoom: 9,
      bearing: undefined,
      pitch: undefined
    });
  });

  it("rejects invalid map view", () => {
    expect(normalizeMapView({ center: ["bad", 50.1], zoom: 9 })).toBeUndefined();
  });

  it("clamps numeric settings", () => {
    expect(clamp(120, 1, 50)).toBe(50);
    expect(clamp(-1, 1, 50)).toBe(1);
  });

  it("stores preferences per local user scope", () => {
    writeUserPreferences({ selectedLayer: "uav" }, "operator-a");
    writeUserPreferences({ selectedLayer: "foreign" }, "operator-b");

    expect(readUserPreferences("operator-a").selectedLayer).toBe("uav");
    expect(readUserPreferences("operator-b").selectedLayer).toBe("foreign");
  });
});

function installLocalStorageMock() {
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value)
    }
  });
}
