// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./main";
import { writeCopOfflineSnapshot } from "./pwa-offline";

vi.mock("./CopMap", async () => {
  const React = await import("react");
  return {
    CopMap: ({ objects, emptyMessage }: { objects: Array<{ objectId: string }>; emptyMessage: string }) =>
      React.createElement(
        "div",
        { "data-testid": "cop-map" },
        objects.length === 0
          ? React.createElement("span", null, emptyMessage)
          : objects.map((object) => React.createElement("span", { key: object.objectId }, object.objectId))
      )
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
    expect(screen.getByText("APP6-AIR-FRIEND-AIRCRAFT-ACTIVE")).toBeTruthy();
    expect(screen.getByText("SFAP-----------")).toBeTruthy();
    expect(screen.getByText("SIM")).toBeTruthy();
    expect(screen.queryByText("Source Registry")).toBeNull();
    const airSituationGroup = screen.getByText("Air situation").closest(".layer-source-group") as HTMLElement;
    const trackLayerCheckboxes = within(airSituationGroup).getAllByRole("checkbox") as HTMLInputElement[];
    expect(trackLayerCheckboxes[0]?.checked).toBe(true);
    expect(trackLayerCheckboxes.slice(1).every((checkbox) => checkbox.checked && checkbox.disabled)).toBe(true);
    expect(screen.getByRole("button", { name: /Mapa/u }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Data/u }));
    expect(screen.getByText("Zobrazit simulovaná data")).toBeTruthy();
    expect(screen.getByText("Profily pohledu")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /UAV watch/u }));
    expect(screen.getByText("Aktivní: UAV watch")).toBeTruthy();
    expect(screen.getAllByText("UAV").some((node) => node.closest("button")?.textContent?.includes("1"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Zdroje/u }));
    expect(screen.getByRole("button", { name: /Zdroje/u }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText("COP Air Situation Simulator").length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/cop/tracks?includeSynthetic=true"), {
      headers: { Authorization: "Bearer dev-lab-token" }
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/cop/track-history?seconds=180&limit=120"), {
      headers: { Authorization: "Bearer dev-lab-token" }
    });

    fireEvent.click(screen.getByRole("button", { name: /Operátor/u }));
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

    await waitFor(() => expect(screen.getByText(/SIM zdroj je připojený/u)).toBeTruthy());
    expect(screen.queryByText("Čekám na georeferencované COP tracky.")).toBeNull();
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
    expect(screen.getByText("Degraded read-only fallback")).toBeTruthy();
    expect(screen.getByText(/Zobrazuji lokální read-only snapshot/u)).toBeTruthy();
  });
});

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
