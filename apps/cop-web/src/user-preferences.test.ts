// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  clamp,
  normalizeMapView,
  normalizeUserPreferences,
  readLocalAlertPreferences,
  readUserPreferences,
  writeLocalAlertPreferences,
  writeUserPreferences
} from "./user-preferences";

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

  it("stores user alert zones per local user scope", () => {
    writeLocalAlertPreferences({
      aoiRules: [
        {
          color: "#8cb6d8",
          enabled: true,
          fillOpacity: 0.14,
          id: "zone-a",
          lat: 50.1,
          lon: 14.4,
          name: "Testovací zóna",
          polygon: {
            coordinates: [[
              [14.4, 50.1],
              [14.5, 50.1],
              [14.5, 50.2],
              [14.4, 50.1]
            ]],
            type: "Polygon"
          },
          radiusKm: 12
        }
      ]
    }, "operator-a", "2026-06-01T10:00:00.000Z");
    writeLocalAlertPreferences({ aoiRules: [] }, "operator-b", "2026-06-01T11:00:00.000Z");

    expect(readLocalAlertPreferences("operator-a")).toMatchObject({
      alertPreferences: {
        aoiRules: [
          {
            enabled: true,
            id: "zone-a",
            name: "Testovací zóna",
            polygon: {
              type: "Polygon"
            }
          }
        ]
      },
      updatedAt: "2026-06-01T10:00:00.000Z"
    });
    expect(readLocalAlertPreferences("operator-b")).toMatchObject({
      alertPreferences: {
        aoiRules: []
      },
      updatedAt: "2026-06-01T11:00:00.000Z"
    });
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
