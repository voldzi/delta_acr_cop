// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./main";

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
      if (url.includes("/api/v1/cop/track-history?seconds=180&limit=120")) {
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
    expect(screen.getByText("COP Air Situation Simulator")).toBeTruthy();
    expect(screen.getByText("APP6-AIR-FRIEND-AIRCRAFT-ACTIVE")).toBeTruthy();
    expect(screen.getByText("SFAP-----------")).toBeTruthy();
    expect(screen.getByText("SIM")).toBeTruthy();
    expect(screen.getByText("Zobrazit simulované cíle")).toBeTruthy();
    expect(screen.getAllByText("UAV").some((node) => node.closest("button")?.textContent?.includes("1"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/cop/tracks?includeSynthetic=true"), {
      headers: { Authorization: "Bearer dev-lab-token" }
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/cop/track-history?seconds=180&limit=120"), {
      headers: { Authorization: "Bearer dev-lab-token" }
    });

    fireEvent.click(screen.getByRole("button", { name: /Operátor/u }));
    fireEvent.click(screen.getByRole("tab", { name: "Mapa" }));
    expect(screen.getByText("Čas historie")).toBeTruthy();
    expect(screen.getByRole("button", { name: "180s" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "60s" }));
    expect(screen.getByRole("button", { name: "60s" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("explains an empty map when the SIM source is connected but no active tracks are present", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/health/ready")) {
        return jsonResponse({ status: "ok", timestamp: "2026-05-19T08:00:00Z" });
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
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body
  } as Response;
}
