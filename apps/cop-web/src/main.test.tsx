// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, buildStableSituationQueryBounds, mapBoundsContainedBy } from "./main";
import { writeCopOfflineSnapshot } from "./pwa-offline";

vi.mock("./CopMap", async () => {
  const React = await import("react");
  return {
    CopMap: ({
      emptyMessage,
      mapInteractionSuspended,
      objects
    }: {
      emptyMessage: string;
      mapInteractionSuspended?: boolean;
      objects: Array<{ objectId: string }>;
    }) =>
      React.createElement(
        "div",
        {
          "data-map-interaction-suspended": String(Boolean(mapInteractionSuspended)),
          "data-testid": "cop-map"
        },
        objects.length === 0
          ? React.createElement("span", null, emptyMessage)
          : objects.map((object) => React.createElement("span", { key: object.objectId }, object.objectId))
      ),
    formatTrackLabel: (object: { attributes?: { flightData?: { callsign?: string; icao24?: string; registration?: string } }; objectId: string }) =>
      object.attributes?.flightData?.callsign
      ?? object.attributes?.flightData?.registration
      ?? object.attributes?.flightData?.icao24
      ?? object.objectId
  };
});

afterEach(() => {
  cleanup();
  if (typeof window.localStorage?.clear === "function") {
    window.localStorage.clear();
  }
  vi.restoreAllMocks();
});

describe("COP web dashboard", () => {
  it("keeps situation provider bounds stable while zooming into weather grids", () => {
    const initialBounds = { east: 16.2, north: 50.3, south: 49.4, west: 14.6 };
    const queryBounds = buildStableSituationQueryBounds(initialBounds);

    expect(queryBounds).toEqual({
      east: 17,
      north: 50.75,
      south: 49,
      west: 13.75
    });
    expect(mapBoundsContainedBy(queryBounds, { east: 15.85, north: 50.15, south: 49.55, west: 14.9 })).toBe(true);
    expect(mapBoundsContainedBy(queryBounds, { east: 17.1, north: 50.15, south: 49.55, west: 14.9 })).toBe(false);
  });

  it("renders SIM tracks returned from COP API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/health/ready")) {
        return jsonResponse({ status: "ok", timestamp: "2026-05-19T08:00:00Z" });
      }
      if (url.includes("/api/v1/me/preferences")) {
        return jsonResponse({
          actor: {
            authMode: "lab",
            displayName: "Lab operator",
            subjectId: "lab",
            username: "lab"
          },
          alertPreferences: {},
          preferences: {
            trackHistoryLimit: 120,
            trackHistoryWindowSeconds: 180
          },
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/sources/health")) {
        return jsonResponse({
          items: [
            {
              acceptedEvents: 2,
              currentTracks: 2,
              sourceSystemId: "sim-air-situation-001",
              displayName: "COP Air Situation Simulator",
              expiredTracks: 0,
              health: "ONLINE",
              lowConfidenceTracks: 0,
              sourceType: "SIMULATOR",
              staleTracks: 0,
              status: "ACTIVE",
              synthetic: true,
              totalTracks: 2
            }
          ]
        });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({
          items: [
            {
              sourceSystemId: "sim-air-situation-001",
              displayName: "COP Air Situation Simulator",
              sourceType: "SIMULATOR",
              status: "ACTIVE",
              synthetic: true
            }
          ]
        });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({
          items: [
            {
              objectId: "AIR_SIM_AIRCRAFT-0001",
              objectType: "AIRCRAFT",
              affiliation: "FRIEND",
              domain: "AIR",
              status: "ACTIVE",
              confidence: 0.91,
              synthetic: true,
              attributes: {
                provenance: {
                  adapterId: "sim-adapter",
                  adapterVersion: "0.1.0",
                  sourceSystemId: "sim-air-situation-001"
                }
              },
              position: {
                lat: 50.087,
                lon: 14.421
              }
            },
            {
              objectId: "AIR_SIM_UAV-0001",
              objectType: "UAV",
              affiliation: "FRIEND",
              domain: "AIR",
              status: "ACTIVE",
              confidence: 0.82,
              synthetic: true,
              position: {
                lat: 50.09,
                lon: 14.43
              }
            }
          ]
        });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({
          items: [
            {
              objectId: "AIR_SIM_AIRCRAFT-0001",
              points: [
                {
                  affiliation: "FRIEND",
                  lat: 50.087,
                  lon: 14.421,
                  objectId: "AIR_SIM_AIRCRAFT-0001",
                  timestamp: "2026-05-19T08:00:00Z"
                }
              ]
            }
          ]
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await waitFor(() => expect(screen.getAllByText("AIR_SIM_AIRCRAFT-0001").length).toBeGreaterThan(0));
    expect(screen.getByTestId("cop-map").textContent).toContain("AIR_SIM_UAV-0001");
    expect(screen.getByTestId("cop-map").getAttribute("data-map-interaction-suspended")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Komunikace" }));
    expect(screen.getByTestId("cop-map").getAttribute("data-map-interaction-suspended")).toBe("false");
    expect(screen.getByText("Standardní operační symbol")).toBeTruthy();
    expect(screen.queryByText("APP6-AIR-FRIEND-AIRCRAFT-ACTIVE")).toBeNull();
    expect(screen.queryByText("SFAP-----------")).toBeNull();
    expect(screen.getByText("SIM")).toBeTruthy();
    expect(screen.queryByText("Source Registry")).toBeNull();
    expect(screen.getByTestId("catalog-layer-rail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Letecký provoz/u }));
    const catalogDrawer = screen.getByTestId("catalog-layer-drawer");
    expect(within(catalogDrawer).getByText("Veřejné lety")).toBeTruthy();
    expect((within(catalogDrawer).getByRole("checkbox", { name: /Veřejné lety/u }) as HTMLInputElement).checked).toBe(true);
    expect(within(catalogDrawer).getByText("Simulace")).toBeTruthy();
    expect((within(catalogDrawer).getByRole("checkbox", { name: /Simulace/u }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Mobilní navigace" })).getByRole("button", { name: "Vrstvy" }));
    const mobileSheet = screen.getByTestId("mobile-sheet-surface");
    expect(screen.getByTestId("cop-map").getAttribute("data-map-interaction-suspended")).toBe("true");
    const mobilePublicFlightToggle = within(mobileSheet).getByRole("checkbox", { name: /Veřejné lety/u }) as HTMLInputElement;
    expect(mobilePublicFlightToggle.checked).toBe(true);
    fireEvent.click(mobilePublicFlightToggle);
    expect(mobilePublicFlightToggle.checked).toBe(false);
    const mapWorkspaceTab = screen.getAllByRole("button", { name: /Mapa/u }).find((button) => button.classList.contains("workspace-tab"));
    expect(mapWorkspaceTab?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Přehled/u }));
    expect(screen.getByText("Zobrazit simulovaná data")).toBeTruthy();
    const objectSearchInput = screen.getAllByLabelText("Hledat v zobrazených objektech")[0] as HTMLInputElement;
    fireEvent.change(objectSearchInput, { target: { value: "UAV" } });
    await waitFor(() => expect(screen.getByTestId("cop-map").textContent).toContain("AIR_SIM_UAV-0001"));
    expect(screen.getByTestId("cop-map").textContent).not.toContain("AIR_SIM_AIRCRAFT-0001");
    expect(screen.getAllByText("1 z 2").length).toBeGreaterThan(0);
    const clearSearchButton = screen.getAllByRole("button", { name: "Vymazat hledání" })[0];
    if (!clearSearchButton) {
      throw new Error("Clear search button not found");
    }
    fireEvent.click(clearSearchButton);
    await waitFor(() => expect(screen.getByTestId("cop-map").textContent).toContain("AIR_SIM_AIRCRAFT-0001"));
    expect(screen.getByText("Profily pohledu")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /UAV watch/u }));
    expect(screen.getByText("Aktivní: UAV watch")).toBeTruthy();
    expect(screen.getAllByText("UAV").some((node) => node.closest(".source-layer-toggle")?.textContent?.includes("1"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Zdroje/u }));
    expect(screen.getByRole("button", { name: /Zdroje/u }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText("COP Air Situation Simulator").length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/cop/tracks?includeSynthetic=true"), {
      headers: { Authorization: "Bearer dev-lab-token" }
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/cop/track-history?seconds=180&limit=120"), {
      headers: { Authorization: "Bearer dev-lab-token" }
    });

    fireEvent.click(screen.getByTitle("Nastavení operátora"));
    fireEvent.click(screen.getByRole("tab", { name: "Mapa" }));
    expect(screen.getByText("Čas historie")).toBeTruthy();
    expect(screen.getByRole("button", { name: "60s" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "60s" }));
    expect(screen.getByRole("button", { name: "60s" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("explains an empty map when the SIM source is connected but no active tracks are present", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/health/ready")) {
        return jsonResponse({ status: "ok", timestamp: "2026-05-19T08:00:00Z" });
      }
      if (url.includes("/api/v1/me/preferences")) {
        return jsonResponse({
          actor: {
            authMode: "lab",
            displayName: "Lab operator",
            subjectId: "lab",
            username: "lab"
          },
          alertPreferences: {},
          preferences: {
            trackHistoryLimit: 120,
            trackHistoryWindowSeconds: 180
          },
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/sources/health")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({
          items: [
            {
              sourceSystemId: "sim-air-situation-001",
              displayName: "COP Air Situation Simulator",
              sourceType: "SIMULATOR",
              status: "ACTIVE",
              synthetic: true
            }
          ]
        });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/track-history?seconds=180&limit=120")) {
        return jsonResponse({ items: [] });
      }
      throw new Error(`Unexpected request ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await waitFor(() => expect(screen.getByText(/Datový zdroj je připojený/u)).toBeTruthy());
    expect(screen.queryByText("Čekám na georeferencované situační objekty.")).toBeNull();
  });

  it("restores the last local snapshot when the COP API is unavailable", async () => {
    installTestLocalStorage();
    writeCopOfflineSnapshot(
      {
        alerts: [],
        health: {
          status: "ok",
          timestamp: "2026-05-19T08:00:00Z"
        },
        objects: [
          {
            affiliation: "HOSTILE",
            confidence: 0.88,
            domain: "AIR",
            objectId: "OFFLINE_TRACK-001",
            objectType: "UAV",
            position: {
              lat: 50.11,
              lon: 14.45
            },
            status: "ACTIVE",
            synthetic: true
          }
        ],
        sourceHealth: [],
        sources: [
          {
            displayName: "Cached SIM source",
            sourceSystemId: "sim-air-situation-001",
            sourceType: "SIMULATOR",
            status: "ACTIVE",
            synthetic: true
          }
        ],
        trackHistory: {}
      },
      "lab",
      "2026-05-19T08:00:00Z"
    );
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("Network down");
    }));

    render(<App />);

    await waitFor(() => expect(screen.getAllByText("OFFLINE_TRACK-001").length).toBeGreaterThan(0));
    expect(screen.getByText("Omezený režim s uloženým náhledem")).toBeTruthy();
    expect(screen.getByText(/Uloženo/u)).toBeTruthy();
  });
});

function testMapCatalogResponse(): unknown {
  return {
    catalogVersion: "map-catalog-v1",
    generatedAt: "2026-05-19T08:00:00Z",
    groups: [
      { groupId: "risks", icon: "alert-triangle", label: "Rizika a výstrahy", order: 10 },
      { groupId: "risks.weather", icon: "cloud-sun", label: "Počasí", order: 20, parentGroupId: "risks" },
      { groupId: "flight", icon: "plane", label: "Letecký provoz", order: 50 }
    ],
    layers: [
      {
        audience: "public",
        defaultVisible: true,
        geometryTypes: ["Point"],
        groupId: "flight",
        kind: "track_stream",
        label: "Veřejné lety",
        layerId: "flight.public.tracks",
        maxZoom: 18,
        minZoom: 4,
        query: {
          mode: "stream",
          providerId: "cop.tracks",
          streamId: "cop.live"
        },
        refreshSeconds: 5,
        role: "primary",
        selectable: true,
        styleProfile: "flight-public-track-v1"
      },
      {
        audience: "public",
        defaultVisible: true,
        geometryTypes: ["Point"],
        groupId: "flight",
        kind: "track_stream",
        label: "Simulace",
        layerId: "flight.sim.tracks",
        maxZoom: 18,
        minZoom: 4,
        query: {
          mode: "stream",
          providerId: "cop.tracks",
          streamId: "cop.live"
        },
        refreshSeconds: 5,
        role: "primary",
        selectable: true,
        styleProfile: "sim-air-track-v1"
      },
      {
        audience: "public",
        defaultVisible: true,
        geometryTypes: ["Point"],
        groupId: "risks.weather",
        kind: "vector_features",
        label: "Počasí",
        layerId: "public.weather.current",
        query: {
          maxFeatures: 50,
          mode: "bbox",
          providerId: "sim.situation-data",
          providerLayerIds: ["weather"],
          providerSourceIds: ["open_meteo"],
          streamId: "features"
        },
        refreshSeconds: 600,
        role: "primary",
        selectable: true,
        styleProfile: "weather-current-v1"
      }
    ],
    locale: "cs-CZ",
    providers: [
      { label: "SIM situation data", providerId: "sim.situation-data", status: "online" },
      { label: "COP track stream", providerId: "cop.tracks", status: "online" }
    ],
    sources: [],
    warnings: []
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body
  } as Response;
}

function installTestLocalStorage(): void {
  const localStorageData = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => localStorageData.clear(),
      getItem: (key: string) => localStorageData.get(key) ?? null,
      removeItem: (key: string) => localStorageData.delete(key),
      setItem: (key: string, value: string) => localStorageData.set(key, value)
    }
  });
}
