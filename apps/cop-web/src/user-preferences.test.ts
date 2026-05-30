// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { clamp, normalizeMapView, normalizeUserPreferences, readUserPreferences, writeUserPreferences } from "./user-preferences";

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

  it("normalizes language and outline basemap preferences", () => {
    expect(normalizeUserPreferences({ language: "en", mapBasemapMode: "outline" })).toMatchObject({
      language: "en",
      mapBasemapMode: "outline"
    });
    expect(normalizeUserPreferences({ language: "de", mapBasemapMode: "satellite" })).toMatchObject({
      language: undefined,
      mapBasemapMode: undefined
    });
  });

  it("normalizes workspace layout and operator profile preferences", () => {
    expect(normalizeUserPreferences({
      operatorProfile: {
        avatarDataUrl: "data:image/webp;base64,AAAA",
        contactNote: "  dostupný večer  ",
        displayName: "Jan Novak",
        phone: "+420 123",
        publicContact: true
      },
      workspaceLayout: {
        contextRailVisible: false,
        leftPanelMode: "collapsed",
        leftPanelWidth: 120,
        rightPanelMode: "hidden",
        rightPanelWidth: 900,
        statusbarVisible: false
      },
      workspaceSkin: "field"
    })).toMatchObject({
      operatorProfile: {
        avatarDataUrl: "data:image/webp;base64,AAAA",
        contactNote: "dostupný večer",
        displayName: "Jan Novak",
        phone: "+420 123",
        publicContact: true
      },
      workspaceLayout: {
        contextRailVisible: false,
        leftPanelMode: "collapsed",
        leftPanelWidth: 220,
        rightPanelMode: "hidden",
        rightPanelWidth: 560,
        statusbarVisible: false
      },
      workspaceSkin: "field"
    });
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
