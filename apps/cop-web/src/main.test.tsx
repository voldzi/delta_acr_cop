// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeChatCenterLocation,
  encodeChatSelect,
  encodeChatSummary,
  encodeChatVoiceCall,
  encodeChatVoiceCallCommand
} from "@cop/messaging/bridge";
import {
  App,
  buildPriorityAlertSummary,
  buildSituationMapRequestGroups,
  buildStableSituationQueryBounds,
  firstUnreadChatSummaryRoom,
  formatWeatherStationAttribution,
  hostIncomingChatVoiceCall,
  hostUnreadCountFromChatSummary,
  hostUsableChatSummary,
  hostVisibleChatVoiceCall,
  mapBoundsContainedBy
} from "./main";
import { writeCopOfflineSnapshot } from "./pwa-offline";
import { defaultMapCenter } from "./user-preferences";

const initialMatchMedia = window.matchMedia;
const initialGeolocation = navigator.geolocation;

vi.mock("./CopMap", async () => {
  const React = await import("react");
  return {
    CopMap: ({
      emptyMessage,
      emergencyRoute,
      emergencyRouteMessage,
      emergencyRouteStatus,
      focusView,
      focusViewRequest,
      initialView,
      mapInteractionSuspended,
      objects,
      onRequestIsochroneFromPoint,
      onRequestNearestAccessToPoint,
      onRequestRouteToPoint,
      onRequestUserLocation,
      onSelectObject,
      onStartNavigationToPoint,
      onUserLocationFollowChange,
      onUserMapInteraction,
      onViewChange,
      selectedSituationFeatureId,
      situationFeatures,
      userLocation,
      userLocationFollowEnabled
    }: {
      emptyMessage: string | null;
      emergencyRoute?: { features?: unknown[] } | null;
      emergencyRouteMessage?: string | null;
      emergencyRouteStatus?: string;
      focusView?: { center: [number, number]; zoom?: number };
      focusViewRequest?: number;
      initialView?: { center: [number, number]; zoom?: number };
      mapInteractionSuspended?: boolean;
      objects: Array<{ objectId: string }>;
      onRequestIsochroneFromPoint?: (target: { label?: string; lat: number; lon: number }) => void;
      onRequestNearestAccessToPoint?: (target: { label?: string; lat: number; lon: number }) => void;
      onRequestRouteToPoint?: (
        target: { label?: string; lat: number; lon: number },
        profile?:
          "car" | "emergency_vehicle" | "evacuation_walking" | "large_emergency_vehicle" | "offroad_4x4" | "walking"
      ) => void;
      onRequestUserLocation?: () => void;
      onSelectObject?: (object: { objectId: string }) => void;
      onStartNavigationToPoint?: (
        target: { label?: string; lat: number; lon: number },
        profile?:
          "car" | "emergency_vehicle" | "evacuation_walking" | "large_emergency_vehicle" | "offroad_4x4" | "walking"
      ) => void;
      onUserLocationFollowChange?: (value: boolean) => void;
      onUserMapInteraction?: () => void;
      onViewChange?: (view: { bearing?: number; center: [number, number]; pitch?: number; zoom?: number }) => void;
      selectedSituationFeatureId?: string;
      situationFeatures?: { features?: Array<{ properties?: { featureId?: string; label?: string } }> };
      userLocation?: { lat: number; lon: number } | null;
      userLocationFollowEnabled?: boolean;
    }) =>
      React.createElement(
        "div",
        {
          "data-focus-center": focusView ? `${focusView.center[0].toFixed(5)},${focusView.center[1].toFixed(5)}` : "",
          "data-focus-view-request": String(focusViewRequest ?? 0),
          "data-initial-center": initialView
            ? `${initialView.center[0].toFixed(5)},${initialView.center[1].toFixed(5)}`
            : "",
          "data-emergency-route-features": String(emergencyRoute?.features?.length ?? 0),
          "data-emergency-route-message": emergencyRouteMessage ?? "",
          "data-emergency-route-status": emergencyRouteStatus ?? "idle",
          "data-user-location": userLocation ? `${userLocation.lon.toFixed(5)},${userLocation.lat.toFixed(5)}` : "",
          "data-user-location-follow-enabled": String(Boolean(userLocationFollowEnabled)),
          "data-map-interaction-suspended": String(Boolean(mapInteractionSuspended)),
          "data-selected-situation-feature-id": selectedSituationFeatureId ?? "",
          "data-testid": "cop-map"
        },
        objects.length === 0 && emptyMessage
          ? React.createElement("span", null, emptyMessage)
          : [
              ...objects.map((object) =>
                React.createElement(
                  "button",
                  {
                    "data-testid": `map-select-object-${object.objectId}`,
                    key: object.objectId,
                    onClick: () => onSelectObject?.(object),
                    type: "button"
                  },
                  object.objectId
                )
              ),
              onStartNavigationToPoint
                ? React.createElement(
                    "button",
                    {
                      "data-testid": "map-start-navigation",
                      key: "map-start-navigation",
                      onClick: () =>
                        onStartNavigationToPoint({
                          label: "GROUND_UNIT-1",
                          lat: 50.15077,
                          lon: 17.37303
                        }),
                      type: "button"
                    },
                    "Navigovat z mapy"
                  )
                : null,
              onRequestRouteToPoint
                ? React.createElement(
                    "button",
                    {
                      "data-testid": "map-request-route-walking",
                      key: "map-request-route-walking",
                      onClick: () =>
                        onRequestRouteToPoint(
                          {
                            label: "GROUND_UNIT-1",
                            lat: 50.15077,
                            lon: 17.37303
                          },
                          "walking"
                        ),
                      type: "button"
                    },
                    "Trasa pěšky"
                  )
                : null,
              onRequestNearestAccessToPoint
                ? React.createElement(
                    "button",
                    {
                      "data-testid": "map-request-nearest-access",
                      key: "map-request-nearest-access",
                      onClick: () =>
                        onRequestNearestAccessToPoint({
                          label: "GROUND_UNIT-1",
                          lat: 50.15077,
                          lon: 17.37303
                        }),
                      type: "button"
                    },
                    "Nejbližší přístup"
                  )
                : null,
              onRequestIsochroneFromPoint
                ? React.createElement(
                    "button",
                    {
                      "data-testid": "map-request-isochrone",
                      key: "map-request-isochrone",
                      onClick: () =>
                        onRequestIsochroneFromPoint({
                          label: "GROUND_UNIT-1",
                          lat: 50.15077,
                          lon: 17.37303
                        }),
                      type: "button"
                    },
                    "Dosah 15 min"
                  )
                : null,
              onRequestUserLocation
                ? React.createElement(
                    "button",
                    {
                      "data-testid": "map-request-user-location",
                      key: "map-request-user-location",
                      onClick: () => onRequestUserLocation(),
                      type: "button"
                    },
                    "Přejít na moji polohu"
                  )
                : null,
              onUserLocationFollowChange
                ? React.createElement(
                    "button",
                    {
                      "data-testid": "map-follow-user-location",
                      key: "map-follow-user-location",
                      onClick: () => onUserLocationFollowChange(!userLocationFollowEnabled),
                      type: "button"
                    },
                    "Sledovat moji polohu"
                  )
                : null,
              onViewChange
                ? React.createElement(
                    "button",
                    {
                      "data-testid": "map-simulate-user-pan",
                      key: "map-simulate-user-pan",
                      onClick: () => {
                        onUserMapInteraction?.();
                        onViewChange({ center: [15, 50], zoom: 10 });
                      },
                      type: "button"
                    },
                    "Posunout mapu"
                  )
                : null,
              ...(situationFeatures?.features ?? []).map((feature) =>
                React.createElement(
                  "span",
                  {
                    "data-testid": `map-situation-feature-${feature.properties?.featureId ?? "feature"}`,
                    key: feature.properties?.featureId ?? feature.properties?.label ?? "feature"
                  },
                  feature.properties?.label ?? feature.properties?.featureId ?? "feature"
                )
              )
            ]
      ),
    formatTrackLabel: (object: {
      attributes?: { flightData?: { callsign?: string; icao24?: string; registration?: string } };
      objectId: string;
    }) =>
      object.attributes?.flightData?.callsign ??
      object.attributes?.flightData?.registration ??
      object.attributes?.flightData?.icao24 ??
      object.objectId
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
  if (typeof window.localStorage?.clear === "function") {
    window.localStorage.clear();
  }
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: initialMatchMedia
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: initialGeolocation
  });
  vi.restoreAllMocks();
});

describe("COP web dashboard", () => {
  it("chooses the strongest unread chat room from a summary snapshot", () => {
    expect(
      firstUnreadChatSummaryRoom({
        at: Date.now(),
        syncState: "ready",
        totalUnread: 4,
        type: "cop-chat:summary",
        unreadRooms: [
          { selection: "!low", title: "Low", unreadCount: 1 },
          { selection: "!high", title: "High", unreadCount: 3 },
          { selection: " ", title: "Invalid", unreadCount: 10 }
        ]
      })?.selection
    ).toBe("!high");
    expect(firstUnreadChatSummaryRoom(null)).toBeNull();
  });

  it("ignores stale or unready chat summaries for the host badge", () => {
    const now = Date.parse("2026-07-07T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const freshSummary = {
      at: now,
      syncState: "ready" as const,
      totalUnread: 2,
      type: "cop-chat:summary" as const,
      unreadRooms: [{ selection: "!ops", title: "Ops", unreadCount: 2 }]
    };
    const staleSummary = { ...freshSummary, at: now - 11 * 60 * 1000 };
    const syncingSummary = { ...freshSummary, syncState: "syncing" as const };

    expect(hostUsableChatSummary(freshSummary, now)).toEqual(freshSummary);
    expect(hostUnreadCountFromChatSummary(hostUsableChatSummary(freshSummary, now))).toBe(2);
    expect(hostUsableChatSummary(staleSummary, now)).toBeNull();
    expect(hostUnreadCountFromChatSummary(hostUsableChatSummary(staleSummary, now))).toBe(0);
    expect(hostUsableChatSummary(syncingSummary, now)).toBeNull();
    expect(firstUnreadChatSummaryRoom(staleSummary)).toBeNull();
  });

  it("keeps only fresh active chat voice-call snapshots visible to the host", () => {
    const now = Date.parse("2026-07-07T12:00:00.000Z");
    const ringingCall = encodeChatVoiceCall({
      callId: "call-1",
      direction: "incoming",
      phase: "ringing",
      roomId: "!ops",
      title: "Ops"
    });
    const freshCall = { ...ringingCall, at: now };
    const staleCall = { ...ringingCall, at: now - 6 * 60 * 1000 };
    const endedCall = { ...ringingCall, at: now, phase: "ended" as const };

    expect(hostVisibleChatVoiceCall(freshCall, now)).toEqual(freshCall);
    expect(hostIncomingChatVoiceCall(freshCall)).toEqual(freshCall);
    expect(hostVisibleChatVoiceCall(staleCall, now)).toBeNull();
    expect(hostVisibleChatVoiceCall(endedCall, now)).toBeNull();
  });

  it("formats structured weather station attribution from SIM without rendering objects", () => {
    expect(
      formatWeatherStationAttribution([
        { label: "ČHMÚ měřená meteorologická stanice", role: "observation", sourceId: "chmi_weather_stations" },
        { label: "Open-Meteo modelová předpověď", role: "forecast", sourceId: "open_meteo" },
        { label: "ČHMÚ měřená meteorologická stanice", role: "observation", sourceId: "chmi_weather_stations" }
      ])
    ).toBe("Zdroj: ČHMÚ měřená meteorologická stanice / měření · Open-Meteo modelová předpověď / předpověď");
  });

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

  it("keeps dense infrastructure requests isolated from mobile network context", () => {
    const groups = buildSituationMapRequestGroups(
      ["reference.infrastructure.communications", "public.mobile.network", "public.weather.observations"],
      8,
      "4G"
    );

    expect(groups.map((group) => group.layerIds)).toEqual([
      ["reference.infrastructure.communications"],
      ["public.mobile.network"],
      ["public.weather.observations"]
    ]);
    expect(groups.find((group) => group.layerIds.includes("reference.infrastructure.communications"))?.limit).toBe(
      5000
    );
    expect(groups.find((group) => group.layerIds.includes("public.mobile.network"))?.limit).toBe(5000);
    expect(groups.find((group) => group.layerIds.includes("public.weather.observations"))?.limit).toBe(500);
  });

  it("builds a local priority alert from user-location safety features by relevance", () => {
    const now = Date.now();
    const summary = buildPriorityAlertSummary({
      alerts: [],
      features: [
        {
          geometry: { coordinates: [14.438, 50.076], type: "Point" },
          properties: {
            category: "hydro_station",
            featureId: "hydro-near",
            floodStage: 2,
            label: "Vltava Praha",
            layer: "flood",
            observedAt: new Date(now - 5 * 60_000).toISOString(),
            sourceId: "chmi_hydro",
            tags: { dataSource: "safety-data" },
            validUntil: new Date(now + 60 * 60_000).toISOString()
          },
          type: "Feature"
        },
        {
          geometry: { coordinates: [17.65, 49.22], type: "Point" },
          properties: {
            category: "fire",
            featureId: "fire-far",
            fireStatus: "active",
            label: "Vzdálený požár",
            layer: "fire",
            observedAt: new Date(now - 2 * 60_000).toISOString(),
            severity: "critical",
            sourceId: "nasa_firms",
            tags: { dataSource: "safety-data" },
            validUntil: new Date(now + 60 * 60_000).toISOString()
          },
          type: "Feature"
        }
      ],
      mapView: { center: [14.4378, 50.0755], zoom: 11 },
      objects: [],
      proximityAlerts: [],
      userLocation: {
        lat: 50.0755,
        lon: 14.4378,
        updatedAt: new Date(now).toISOString()
      }
    });

    expect(summary.primary?.id).toBe("feature:hydro-near");
    expect(summary.primary?.badge).toBe("Hydrologie");
    expect(summary.additionalCount).toBe(0);
    expect(summary.reference.source).toBe("user");
  });

  it("does not use map center as a fallback for the top priority alert strip", () => {
    const now = Date.now();
    const summary = buildPriorityAlertSummary({
      alerts: [],
      features: [
        {
          geometry: { coordinates: [14.438, 50.076], type: "Point" },
          properties: {
            category: "hydro_station",
            featureId: "hydro-map-center",
            floodStage: 2,
            label: "Vltava Praha",
            layer: "flood",
            observedAt: new Date(now - 5 * 60_000).toISOString(),
            sourceId: "chmi_hydro",
            tags: { dataSource: "safety-data" },
            validUntil: new Date(now + 60 * 60_000).toISOString()
          },
          type: "Feature"
        }
      ],
      mapView: { center: [14.4378, 50.0755], zoom: 11 },
      objects: [],
      proximityAlerts: [],
      userLocation: null
    });

    expect(summary.primary).toBeNull();
    expect(summary.total).toBe(0);
    expect(summary.reference.source).toBe("map");
  });

  it("uses localized SIM safety metadata for priority alert titles", () => {
    const now = Date.now();
    const summary = buildPriorityAlertSummary({
      alerts: [],
      features: [
        {
          geometry: { coordinates: [14.438, 50.076], type: "Point" },
          properties: {
            category: "legacy.weather",
            featureId: "heat-near",
            hazardType: "legacy_hazard_text",
            label: "Fallback label",
            layer: "weather_alerts",
            localized: {
              cs: {
                headline: "Vysoké teploty v okolí"
              }
            },
            providerProperties: {
              presentation: {
                iconKey: "weather.temperature.high",
                styleKey: "heat-warning"
              },
              taxonomy: {
                sourceCode: "I.2",
                sourceSystem: "CHMI_SIVS",
                typeCode: "weather.temperature.high"
              }
            },
            severity: "warning",
            sourceId: "chmi_alerts",
            tags: { dataSource: "safety-data" },
            validUntil: new Date(now + 60 * 60_000).toISOString()
          },
          type: "Feature"
        }
      ],
      mapView: { center: [14.4378, 50.0755], zoom: 11 },
      objects: [],
      proximityAlerts: [],
      userLocation: {
        lat: 50.0755,
        lon: 14.4378,
        updatedAt: new Date(now).toISOString()
      }
    });

    expect(summary.primary?.title).toBe("Vysoké teploty v okolí");
    expect(summary.primary?.id).toBe("feature:heat-near");
  });

  it("keeps road SRTI warnings out of the top priority alert strip", () => {
    const now = Date.now();
    const summary = buildPriorityAlertSummary({
      alerts: [],
      features: [
        {
          geometry: { coordinates: [14.438, 50.076], type: "Point" },
          properties: {
            category: "road.accident",
            description: "Dopravně-bezpečnostní SRTI událost.",
            featureId: "road-accident",
            headline: "Dopravní nehoda",
            label: "Dopravní nehoda",
            layer: "warnings",
            severity: "critical",
            sourceId: "road_srti_lod",
            tags: { dataSource: "safety-data" },
            typeCode: "road.accident",
            validUntil: new Date(now + 60 * 60_000).toISOString()
          },
          type: "Feature"
        },
        {
          geometry: { coordinates: [14.44, 50.077], type: "Point" },
          properties: {
            category: "rescue",
            featureId: "hzs-incident",
            headline: "Zásah HZS",
            label: "Zásah HZS",
            layer: "warnings",
            severity: "warning",
            sourceId: "hzs_incidents",
            tags: { dataSource: "safety-data" },
            typeCode: "rescue.technical",
            validUntil: new Date(now + 60 * 60_000).toISOString()
          },
          type: "Feature"
        }
      ],
      mapView: { center: [14.4378, 50.0755], zoom: 11 },
      objects: [],
      proximityAlerts: [],
      userLocation: {
        lat: 50.0755,
        lon: 14.4378,
        updatedAt: new Date(now).toISOString()
      }
    });

    expect(summary.primary?.id).toBe("feature:hzs-incident");
    expect(summary.primary?.title).toBe("Zásah HZS");
    expect(summary.total).toBe(1);
    expect(summary.additionalCount).toBe(0);
  });

  it("keeps technical server alerts and track lifecycle out of the public priority alert strip", () => {
    const now = Date.now();
    const summary = buildPriorityAlertSummary({
      alerts: [
        {
          alertId: "track-lost-1",
          detail: "Track lifecycle stop.",
          observedAt: new Date(now - 60_000).toISOString(),
          severity: "critical",
          status: "ACTIVE",
          title: "TRACK_LOST",
          type: "TRACK_LOST",
          updatedAt: new Date(now - 30_000).toISOString()
        },
        {
          alertId: "source-degraded-1",
          detail: "Provider degraded.",
          observedAt: new Date(now - 60_000).toISOString(),
          severity: "warning",
          status: "ACTIVE",
          title: "SOURCE_DEGRADED",
          type: "SOURCE_DEGRADED",
          updatedAt: new Date(now - 30_000).toISOString()
        }
      ],
      features: [
        {
          geometry: { coordinates: [14.438, 50.076], type: "Point" },
          properties: {
            category: "weather",
            featureId: "weather-context",
            label: "Měřené počasí",
            layer: "weather",
            observedAt: new Date(now - 5 * 60_000).toISOString(),
            severity: "warning",
            sourceId: "chmi_weather_stations"
          },
          type: "Feature"
        }
      ],
      mapView: { center: [14.4378, 50.0755], zoom: 11 },
      objects: [
        {
          affiliation: "UNKNOWN",
          confidence: 0.2,
          domain: "LAND",
          lastUpdatedAt: new Date(now - 10_000).toISOString(),
          objectId: "low-confidence-track",
          objectType: "VEHICLE",
          position: { lat: 50.076, lon: 14.438 },
          status: "STALE",
          synthetic: false
        }
      ],
      proximityAlerts: [],
      userLocation: null
    });

    expect(summary.total).toBe(0);
    expect(summary.primary).toBeNull();
  });

  it("starts the map over Czechia when persisted location center is unusable", async () => {
    installMatchMedia(true);
    window.localStorage.setItem(
      "cop.user.preferences.v1.lab",
      JSON.stringify({
        autoFit: false,
        mapView: { center: [0, 0], zoom: 9 }
      })
    );
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: undefined
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/map/features")) {
        return jsonResponse(emptyMapQueryResponse([]));
      }
      return jsonResponse({ init, items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const expectedCenter = `${defaultMapCenter[0].toFixed(5)},${defaultMapCenter[1].toFixed(5)}`;
    await waitFor(() => expect(screen.getByTestId("cop-map").getAttribute("data-initial-center")).toBe(expectedCenter));
    expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe(expectedCenter);
  });

  it("focuses the map on the current device location after the location button is clicked", async () => {
    installMatchMedia(true);
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          accuracy: 12,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          latitude: 50.087,
          longitude: 14.421,
          speed: null
        },
        timestamp: Date.parse("2026-05-19T08:00:00Z")
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition }
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/map/features")) {
        return jsonResponse(emptyMapQueryResponse([]));
      }
      return jsonResponse({ init, items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("cop-map")).toBeTruthy());

    fireEvent.click(screen.getByTestId("map-request-user-location"));

    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("cop-map").getAttribute("data-focus-view-request")).toBe("1"));
    expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("14.42100,50.08700");
  });

  it("keeps the user location marker live and follows it only when enabled", async () => {
    installMatchMedia(true);
    const makePosition = (latitude: number, longitude: number): GeolocationPosition =>
      ({
        coords: {
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          latitude,
          longitude,
          speed: null
        },
        timestamp: Date.parse("2026-05-19T08:00:00Z")
      }) as GeolocationPosition;
    const watchCallbacks: PositionCallback[] = [];
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success(makePosition(50.087, 14.421));
    });
    const watchPosition = vi.fn((success: PositionCallback) => {
      watchCallbacks.push(success);
      return 10 + watchCallbacks.length;
    });
    const clearWatch = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { clearWatch, getCurrentPosition, watchPosition }
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/map/features")) {
        return jsonResponse(emptyMapQueryResponse([]));
      }
      return jsonResponse({ init, items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("cop-map")).toBeTruthy());

    fireEvent.click(screen.getByTestId("map-request-user-location"));

    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled());
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-user-location")).toBe("14.42100,50.08700")
    );
    expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("14.42100,50.08700");

    act(() => {
      watchCallbacks[0]?.(makePosition(50.088, 14.422));
    });

    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-user-location")).toBe("14.42200,50.08800")
    );
    expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("14.42100,50.08700");

    fireEvent.click(screen.getByTestId("map-follow-user-location"));

    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-user-location-follow-enabled")).toBe("true")
    );
    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("14.42200,50.08800")
    );

    act(() => {
      watchCallbacks[0]?.(makePosition(50.089, 14.423));
    });

    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-user-location")).toBe("14.42300,50.08900")
    );
    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("14.42300,50.08900")
    );

    fireEvent.click(screen.getByTestId("map-follow-user-location"));

    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-user-location-follow-enabled")).toBe("false")
    );
    expect(clearWatch).toHaveBeenCalledWith(11);

    fireEvent.click(screen.getByTestId("map-follow-user-location"));

    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-user-location-follow-enabled")).toBe("true")
    );
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId("map-simulate-user-pan"));

    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-user-location-follow-enabled")).toBe("false")
    );
    expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("15.00000,50.00000");

    act(() => {
      watchCallbacks.at(-1)?.(makePosition(50.09, 14.424));
    });

    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-user-location")).toBe("14.42400,50.09000")
    );
    expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("15.00000,50.00000");
  });

  it("renders SIM tracks returned from COP API", async () => {
    installMatchMedia(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
    expect((within(catalogDrawer).getByRole("checkbox", { name: /Veřejné lety/u }) as HTMLInputElement).checked).toBe(
      true
    );
    expect(within(catalogDrawer).getByText("Simulace")).toBeTruthy();
    expect((within(catalogDrawer).getByRole("checkbox", { name: /Simulace/u }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Mobilní navigace" })).getByRole("button", { name: "Vrstvy" })
    );
    const mobileSheet = screen.getByTestId("mobile-sheet-surface");
    expect(screen.getByTestId("cop-map").getAttribute("data-map-interaction-suspended")).toBe("true");
    const mobilePublicFlightToggle = within(mobileSheet).getByRole("checkbox", {
      name: /Veřejné lety/u
    }) as HTMLInputElement;
    expect(mobilePublicFlightToggle.checked).toBe(true);
    fireEvent.click(mobilePublicFlightToggle);
    expect(mobilePublicFlightToggle.checked).toBe(false);
    const mapWorkspaceTab = screen
      .getAllByRole("button", { name: /Mapa/u })
      .find((button) => button.classList.contains("workspace-tab"));
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
    expect(
      screen.getAllByText("UAV").some((node) => node.closest(".source-layer-toggle")?.textContent?.includes("1"))
    ).toBe(true);
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

  it("keeps integrated chat open and focuses the map when chat sends a location", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/map/query")) {
        return jsonResponse({
          contractVersion: "cop-map-query-v1",
          generatedAt: "2026-05-19T08:00:00Z",
          query: {
            bbox: { east: 19.1, north: 51.2, south: 48.5, west: 12 },
            layerIds: ["reference.infrastructure.emergency"],
            limit: 5000
          },
          situation: {
            contractVersion: "cop-situation-source-v1",
            features: [
              {
                geometry: { coordinates: [17.3842, 50.1187], type: "Point" },
                id: "police-vrbno",
                properties: {
                  category: "police",
                  featureId: "security-police:vrbno",
                  label: "Policie ČR - Vrbno pod Pradědem",
                  layer: "ground",
                  layerId: "reference.infrastructure.emergency",
                  providerLayerId: "ground",
                  sourceId: "reference.infrastructure.emergency",
                  sourceName: "SIM search-data"
                },
                type: "Feature"
              }
            ],
            generatedAt: "2026-05-19T08:00:00Z",
            query: {
              bbox: { east: 19.1, north: 51.2, south: 48.5, west: 12 },
              layers: ["ground"],
              limit: 5000
            },
            source: {
              sourceId: "situation-data-api",
              sourceType: "PUBLIC_SITUATION_AGGREGATE"
            },
            sources: [],
            summary: {
              featureCount: 1,
              sourceCount: 1,
              staleFeatureCount: 0,
              warningCount: 0
            },
            warnings: []
          },
          summary: {
            featureCount: 1,
            layerCount: 1,
            warningCount: 0
          },
          warnings: []
        });
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("cop-map")).toBeTruthy());
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/map/catalog"), expect.any(Object))
    );
    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.some(
            ([url, options]) =>
              String(url).includes("/api/v1/map/query") &&
              typeof options === "object" &&
              options !== null &&
              "body" in options &&
              String(options.body).includes("public.weather.current")
          )
        ).toBe(true),
      { timeout: 2500 }
    );

    fireEvent.click(screen.getByRole("button", { name: "Komunikace" }));
    expect(screen.getByText("Integrovaný COP Chat")).toBeTruthy();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: encodeChatCenterLocation(50.1187, 17.3842, {
            category: "police",
            featureId: "security-police:vrbno",
            featureKind: "feature",
            label: "Policie ČR - Vrbno pod Pradědem",
            layerId: "reference.infrastructure.emergency",
            sourceName: "SIM search-data",
            sourceSystemIds: ["sim.search-data", "reference.infrastructure.emergency"],
            zoom: 16
          }),
          origin: window.location.origin
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("cop-map").getAttribute("data-focus-view-request")).toBe("1");
    });
    expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("17.38420,50.11870");
    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.some(
            ([url, options]) =>
              String(url).includes("/api/v1/map/query") &&
              typeof options === "object" &&
              options !== null &&
              "body" in options &&
              String(options.body).includes("reference.infrastructure.emergency")
          )
        ).toBe(true),
      { timeout: 2500 }
    );
    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-selected-situation-feature-id")).toBe(
        "security-police:vrbno"
      )
    );
    expect(screen.getByText("Integrovaný COP Chat")).toBeTruthy();
  });

  it("does not enable unrelated SIM catalog layers from a broad chat map action source", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/map/query")) {
        return jsonResponse(emptyMapQueryResponse(["public.weather.current"]));
      }
      if (url.includes("/api/v1/sources/health")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ items: [], init });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("cop-map")).toBeTruthy());
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/map/catalog"), expect.any(Object))
    );
    const callCountBeforeFocus = fetchMock.mock.calls.length;

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: encodeChatCenterLocation(50.15077, 17.37303, {
            category: "weather",
            featureId: "weather:near-map-center",
            featureKind: "feature",
            label: "Weather near map center",
            sourceName: "sim.situation-data",
            sourceSystemIds: ["sim.situation-data"],
            zoom: 16
          }),
          origin: window.location.origin
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("cop-map").getAttribute("data-focus-view-request")).toBe("1");
    });
    const mapQueryBodiesAfterFocus = fetchMock.mock.calls
      .slice(callCountBeforeFocus)
      .filter(([url]) => String(url).includes("/api/v1/map/query"))
      .map(([, options]) => String((options as RequestInit | undefined)?.body ?? ""));
    expect(mapQueryBodiesAfterFocus.some((body) => body.includes("reference.infrastructure.emergency"))).toBe(false);
  });

  it("closes embedded chat on mobile when chat sends a map focus action", async () => {
    installMatchMedia(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/map/query")) {
        return jsonResponse(emptyMapQueryResponse(["reference.infrastructure.emergency"]));
      }
      if (url.includes("/api/v1/sources/health")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ items: [], init });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("cop-map")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByTitle("Zavřít chat")).toBeTruthy();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: encodeChatCenterLocation(50.1187, 17.3842, {
            category: "police",
            featureId: "security-police:vrbno",
            featureKind: "feature",
            label: "Policie ČR - Vrbno pod Pradědem",
            layerId: "reference.infrastructure.emergency",
            zoom: 16
          }),
          origin: window.location.origin
        })
      );
    });

    await waitFor(() => expect(screen.getByTestId("cop-map").getAttribute("data-focus-view-request")).toBe("1"));
    expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("17.38420,50.11870");
    expect(screen.getByTitle("Zavřít chat").closest("aside")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the embedded chat iframe mounted between panel opens", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/map/query")) {
        return jsonResponse(emptyMapQueryResponse(["public.weather.current"]));
      }
      if (url.includes("/api/v1/sources/health")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ items: [], init });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("cop-map")).toBeTruthy());
    await waitFor(() => expect(document.querySelector("iframe.embedded-chat-frame")).toBeTruthy());

    const firstFrame = document.querySelector("iframe.embedded-chat-frame");
    expect(firstFrame).toBeTruthy();
    if (!firstFrame) {
      throw new Error("Embedded chat iframe was not mounted.");
    }
    expect(firstFrame?.closest("aside")?.getAttribute("aria-hidden")).toBe("true");
    const postMessage = vi.fn();
    Object.defineProperty(firstFrame, "contentWindow", { configurable: true, value: { postMessage } });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: encodeChatSummary({
            syncState: "ready",
            totalUnread: 2,
            unreadRooms: [
              {
                preview: "Potřebujeme čerpadlo",
                selection: "!ops:msg.zeleznalady.cz",
                title: "Povodeň",
                type: "group",
                unreadCount: 2
              }
            ]
          }),
          origin: window.location.origin
        })
      );
    });
    await waitFor(() => expect(document.querySelector(".nav-unread-badge")?.textContent).toBe("2"));

    const communicationButton = document.querySelector(
      'button.workspace-tab[title="Otevřít komunikaci"]'
    ) as HTMLButtonElement | null;
    expect(communicationButton).toBeTruthy();
    if (!communicationButton) {
      throw new Error("Communication button was not rendered.");
    }
    fireEvent.click(communicationButton);
    expect(firstFrame?.closest("aside")?.getAttribute("aria-hidden")).toBe("false");
    expect(postMessage).toHaveBeenCalledWith(encodeChatSelect("!ops:msg.zeleznalady.cz"), window.location.origin);

    fireEvent.click(screen.getByTitle("Zavřít chat"));
    const hiddenFrame = document.querySelector("iframe.embedded-chat-frame");
    expect(hiddenFrame).toBe(firstFrame);
    expect(hiddenFrame?.closest("aside")?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(communicationButton);
    const reopenedFrame = document.querySelector("iframe.embedded-chat-frame");
    expect(reopenedFrame).toBe(firstFrame);
    expect(reopenedFrame?.closest("aside")?.getAttribute("aria-hidden")).toBe("false");
  });

  it("shows an incoming call indicator outside chat and opens the call room", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/map/query")) {
        return jsonResponse(emptyMapQueryResponse(["public.weather.current"]));
      }
      if (url.includes("/api/v1/sources/health")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ items: [], init });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("cop-map")).toBeTruthy());
    await waitFor(() => expect(document.querySelector("iframe.embedded-chat-frame")).toBeTruthy());

    const firstFrame = document.querySelector("iframe.embedded-chat-frame");
    expect(firstFrame).toBeTruthy();
    if (!firstFrame) {
      throw new Error("Embedded chat iframe was not mounted.");
    }
    expect(firstFrame.closest("aside")?.getAttribute("aria-hidden")).toBe("true");
    const postMessage = vi.fn();
    Object.defineProperty(firstFrame, "contentWindow", { configurable: true, value: { postMessage } });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: encodeChatVoiceCall({
            callId: "call-1",
            direction: "incoming",
            phase: "ringing",
            roomId: "!ops:msg.zeleznalady.cz",
            title: "COP Operator"
          }),
          origin: window.location.origin
        })
      );
    });

    expect(await screen.findByText("Příchozí hlasový hovor")).toBeTruthy();
    const communicationButton = document.querySelector(
      'button.workspace-tab[title="Příchozí hlasový hovor"]'
    ) as HTMLButtonElement | null;
    expect(communicationButton).toBeTruthy();

    fireEvent.click(screen.getByText("Přijmout"));
    expect(firstFrame.closest("aside")?.getAttribute("aria-hidden")).toBe("false");
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(encodeChatSelect("!ops:msg.zeleznalady.cz"), window.location.origin)
    );
    expect(postMessage).toHaveBeenCalledWith(
      encodeChatVoiceCallCommand({
        action: "answer",
        callId: "call-1",
        roomId: "!ops:msg.zeleznalady.cz"
      }),
      window.location.origin
    );
  });

  it("requests an emergency route when chat sends a route map action", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          accuracy: 15,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          latitude: 50.12952,
          longitude: 17.36285,
          speed: null
        },
        timestamp: Date.parse("2026-05-19T08:00:00Z")
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition }
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/routing/alternatives")) {
        return jsonResponse({
          contractVersion: "sim-emergency-routing-v1",
          features: [
            {
              geometry: {
                coordinates: [
                  [17.36285, 50.12952],
                  [17.37303, 50.15077]
                ],
                type: "LineString"
              },
              properties: { label: "Primární zásahová trasa", role: "primary", routeId: "primary" },
              type: "Feature"
            }
          ],
          generatedAt: "2026-05-19T08:00:00Z",
          providerId: "sim.situation-data.routing",
          quality: { confidence: 0.88, engine: "valhalla", mode: "engine_route" },
          routes: [
            {
              distanceM: 2500,
              durationSeconds: 420,
              quality: { confidence: 0.88, engine: "valhalla", mode: "engine_route" },
              rank: 1,
              routeId: "primary",
              traffic: {
                delayPenaltySeconds: 90,
                incidentCount: 1,
                incidentsOnRoute: [{ id: "closure-1", location: { lat: 50.14, lon: 17.37 }, type: "closure" }],
                sourceStatus: "ok"
              },
              warnings: []
            }
          ],
          traffic: {
            incidentCount: 1,
            limitations: ["Hard exclusion uses Valhalla exclude_locations only for closure-like candidates."],
            sourceStatus: "ok"
          },
          warnings: []
        });
      }
      if (url.includes("/api/v1/map/query")) {
        return jsonResponse(emptyMapQueryResponse(["reference.infrastructure.emergency"]));
      }
      if (url.includes("/api/v1/sources/health")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("cop-map")).toBeTruthy());
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/map/catalog"), expect.any(Object))
    );
    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.some(
            ([url, options]) =>
              String(url).includes("/api/v1/map/query") &&
              typeof options === "object" &&
              options !== null &&
              "body" in options &&
              String(options.body).includes("public.weather.current")
          )
        ).toBe(true),
      { timeout: 2500 }
    );
    await act(async () => {
      await Promise.resolve();
    });
    getCurrentPosition.mockClear();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: encodeChatCenterLocation(50.15077, 17.37303, {
            action: "route",
            category: "flood",
            featureId: "safety:dcf33fc1bc7fff2a7c66cad3",
            featureKind: "feature",
            label: "Mnichov - Černá Opava",
            layerId: "reference.infrastructure.emergency",
            zoom: 16
          }),
          origin: window.location.origin
        })
      );
    });

    await waitFor(() => expect(screen.getByTestId("cop-map").getAttribute("data-focus-view-request")).toBe("1"));
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled());
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/routing/alternatives"))).toBe(true)
    );
    const routeCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/v1/routing/alternatives"));
    const routeBody = JSON.parse(String((routeCall?.[1] as RequestInit | undefined)?.body));
    expect(routeBody).toMatchObject({
      alternatives: 2,
      avoid: ["road_closure"],
      from: { lat: 50.12952, lon: 17.36285 },
      includeSteps: true,
      profileId: "emergency_vehicle",
      to: { label: "Mnichov - Černá Opava", lat: 50.15077, lon: 17.37303 }
    });
    expect(getCurrentPosition).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-emergency-route-status")).toBe("ready")
    );
    expect(screen.getByTestId("cop-map").getAttribute("data-emergency-route-features")).toBe("1");
    expect(screen.getByTestId("cop-map").getAttribute("data-emergency-route-message")).toContain(
      "Zásahová trasa: 2.5 km"
    );
    expect(screen.getByTestId("cop-map").getAttribute("data-emergency-route-message")).toContain(
      "Hard exclusion uses Valhalla exclude_locations"
    );
  });

  it("starts car navigation from a map navigation action", async () => {
    installMatchMedia(false);
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          accuracy: 9,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          latitude: 50.12952,
          longitude: 17.36285,
          speed: null
        },
        timestamp: Date.parse("2026-05-19T08:00:00Z")
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition }
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/routing/alternatives")) {
        return jsonResponse({
          contractVersion: "sim-emergency-routing-v1",
          features: [
            {
              geometry: {
                coordinates: [
                  [17.36285, 50.12952],
                  [17.37303, 50.15077]
                ],
                type: "LineString"
              },
              properties: { label: "Navigace autem", role: "primary", routeId: "primary" },
              type: "Feature"
            }
          ],
          generatedAt: "2026-05-19T08:00:00Z",
          providerId: "sim.situation-data.routing",
          quality: { confidence: 0.91, engine: "valhalla", mode: "engine_route" },
          routes: [
            {
              distanceM: 2500,
              durationSeconds: 420,
              steps: [{ instruction: "Pokračujte po silnici k cíli." }],
              quality: { confidence: 0.91, engine: "valhalla", mode: "engine_route" },
              rank: 1,
              routeId: "primary",
              warnings: []
            }
          ],
          warnings: []
        });
      }
      if (url.includes("/api/v1/map/query")) {
        return jsonResponse(emptyMapQueryResponse(["public.weather.current"]));
      }
      if (url.includes("/api/v1/sources/health")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({
          items: [
            {
              affiliation: "FRIEND",
              confidence: 0.9,
              domain: "LAND",
              objectId: "GROUND_UNIT-1",
              objectType: "VEHICLE",
              position: { lat: 50.15077, lon: 17.37303 },
              status: "ACTIVE"
            }
          ]
        });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ items: [], init });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByTestId("map-start-navigation"));
    fireEvent.click(await screen.findByRole("button", { name: /Auto/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/routing/alternatives"))).toBe(true)
    );
    const routeCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/v1/routing/alternatives"));
    const routeBody = JSON.parse(String((routeCall?.[1] as RequestInit | undefined)?.body));
    expect(routeBody).toMatchObject({
      alternatives: 2,
      avoid: ["road_closure"],
      from: { lat: 50.12952, lon: 17.36285 },
      includeSteps: true,
      profileId: "car",
      to: { label: "GROUND_UNIT-1", lat: 50.15077, lon: 17.37303 }
    });
    await waitFor(() => expect(screen.getByLabelText("Navigace")).toBeTruthy());
    expect(screen.getByText("Navigace autem")).toBeTruthy();
    expect(screen.getByText("Pokračujte po silnici k cíli.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Přepočítat/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/v1/routing/alternatives"))).toHaveLength(
        2
      )
    );
    const rerouteCall = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/v1/routing/alternatives"))[1];
    const rerouteBody = JSON.parse(String((rerouteCall?.[1] as RequestInit | undefined)?.body));
    expect(rerouteBody).toMatchObject({
      alternatives: 2,
      avoid: ["road_closure"],
      from: { lat: 50.12952, lon: 17.36285 },
      includeSteps: true,
      profileId: "car",
      to: { label: "GROUND_UNIT-1", lat: 50.15077, lon: 17.37303 }
    });
  });

  it("runs walking route, nearest-access and isochrone actions from a map point", async () => {
    installMatchMedia(false);
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          accuracy: 11,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          latitude: 50.12952,
          longitude: 17.36285,
          speed: null
        },
        timestamp: Date.parse("2026-05-19T08:00:00Z")
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition }
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/health/ready")) {
        return jsonResponse({ status: "ok", timestamp: "2026-05-19T08:00:00Z" });
      }
      if (url.includes("/api/v1/me/preferences")) {
        return jsonResponse({
          actor: { authMode: "lab", displayName: "Lab operator", subjectId: "lab", username: "lab" },
          alertPreferences: {},
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/routing/profiles")) {
        return jsonResponse({
          profiles: [
            { profileId: "car" },
            { profileId: "emergency_vehicle" },
            { profileId: "large_emergency_vehicle" },
            { profileId: "offroad_4x4" },
            { profileId: "walking" },
            { profileId: "evacuation_walking" }
          ],
          warnings: []
        });
      }
      if (url.includes("/api/v1/routing/alternatives")) {
        return jsonResponse({
          features: [
            {
              geometry: {
                coordinates: [
                  [17.36285, 50.12952],
                  [17.37303, 50.15077]
                ],
                type: "LineString"
              },
              properties: { label: "Pěší trasa", rank: 1, role: "primary", routeId: "walk-primary" },
              type: "Feature"
            }
          ],
          quality: { confidence: 0.93, engine: "valhalla", mode: "engine_route" },
          routes: [{ distanceM: 1800, durationSeconds: 1100, rank: 1, routeId: "walk-primary" }],
          warnings: []
        });
      }
      if (url.includes("/api/v1/routing/nearest-access")) {
        return jsonResponse({
          features: [
            {
              geometry: { coordinates: [17.371, 50.149], type: "Point" },
              properties: { label: "Přístup", role: "access" },
              type: "Feature"
            }
          ],
          warnings: []
        });
      }
      if (url.includes("/api/v1/routing/isochrone")) {
        return jsonResponse({
          features: [
            {
              geometry: {
                coordinates: [
                  [
                    [17.36, 50.14],
                    [17.38, 50.14],
                    [17.38, 50.16],
                    [17.36, 50.14]
                  ]
                ],
                type: "Polygon"
              },
              properties: { label: "15 min", role: "isochrone" },
              type: "Feature"
            }
          ],
          warnings: []
        });
      }
      if (url.includes("/api/v1/map/query")) {
        return jsonResponse(emptyMapQueryResponse(["public.weather.current"]));
      }
      if (url.includes("/api/v1/sources/health")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByTestId("map-request-route-walking"));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/routing/alternatives"))).toBe(true)
    );
    const walkingCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/v1/routing/alternatives"));
    expect(JSON.parse(String((walkingCall?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      alternatives: 2,
      avoid: [],
      includeSteps: true,
      profileId: "walking"
    });

    fireEvent.click(screen.getByTestId("map-request-nearest-access"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/routing/nearest-access"))).toBe(true)
    );
    const nearestCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/v1/routing/nearest-access"));
    expect(JSON.parse(String((nearestCall?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      point: { label: "GROUND_UNIT-1", lat: 50.15077, lon: 17.37303 },
      profileId: "offroad_4x4"
    });

    fireEvent.click(screen.getByTestId("map-request-isochrone"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/routing/isochrone"))).toBe(true)
    );
    const isochroneCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/v1/routing/isochrone"));
    expect(JSON.parse(String((isochroneCall?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      profileId: "walking",
      rangeSeconds: 900
    });
  });

  it("clears a previous emergency route when chat sends a plain map focus action", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          accuracy: 15,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          latitude: 50.12952,
          longitude: 17.36285,
          speed: null
        },
        timestamp: Date.parse("2026-05-19T08:00:00Z")
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition }
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          preferences: {},
          updatedAt: "2026-05-19T08:00:00Z"
        });
      }
      if (url.includes("/api/v1/map/catalog")) {
        return jsonResponse(testMapCatalogResponse());
      }
      if (url.includes("/api/v1/routing/alternatives")) {
        return jsonResponse({
          contractVersion: "sim-emergency-routing-v1",
          features: [
            {
              geometry: {
                coordinates: [
                  [17.36285, 50.12952],
                  [17.37303, 50.15077]
                ],
                type: "LineString"
              },
              properties: { label: "Primární zásahová trasa", role: "primary", routeId: "primary" },
              type: "Feature"
            }
          ],
          generatedAt: "2026-05-19T08:00:00Z",
          providerId: "sim.situation-data.routing",
          quality: { confidence: 0.88, engine: "valhalla", mode: "engine_route" },
          routes: [
            {
              distanceM: 2500,
              durationSeconds: 420,
              quality: { confidence: 0.88, engine: "valhalla", mode: "engine_route" },
              rank: 1,
              routeId: "primary",
              warnings: []
            }
          ],
          warnings: []
        });
      }
      if (url.includes("/api/v1/map/query")) {
        return jsonResponse(emptyMapQueryResponse(["reference.infrastructure.emergency"]));
      }
      if (url.includes("/api/v1/sources/health")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("cop-map")).toBeTruthy());

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: encodeChatCenterLocation(50.15077, 17.37303, {
            action: "route",
            featureId: "safety:dcf33fc1bc7fff2a7c66cad3",
            featureKind: "feature",
            label: "Mnichov - Černá Opava",
            layerId: "reference.infrastructure.emergency",
            zoom: 16
          }),
          origin: window.location.origin
        })
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-emergency-route-status")).toBe("ready")
    );
    expect(screen.getByTestId("cop-map").getAttribute("data-emergency-route-features")).toBe("1");

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: encodeChatCenterLocation(50.1187, 17.3842, {
            featureId: "security-police:vrbno",
            featureKind: "feature",
            label: "Policie ČR - Vrbno pod Pradědem",
            layerId: "reference.infrastructure.emergency",
            zoom: 16
          }),
          origin: window.location.origin
        })
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("17.38420,50.11870")
    );
    expect(screen.getByTestId("cop-map").getAttribute("data-emergency-route-status")).toBe("idle");
    expect(screen.getByTestId("cop-map").getAttribute("data-emergency-route-features")).toBe("0");
    expect(screen.getByTestId("cop-map").getAttribute("data-emergency-route-message")).toBe("");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/v1/routing/alternatives"))).toHaveLength(
      1
    );
  });

  it("initializes the map from standalone chat COP focus URL parameters", async () => {
    window.history.replaceState(
      null,
      "",
      "/?copLat=50.1187&copLon=17.3842&copZoom=16&copLabel=Policie&copFeatureKind=feature&copFeatureId=security-police%3Avrbno&copLayerId=reference.infrastructure.emergency"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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
            preferences: {},
            updatedAt: "2026-05-19T08:00:00Z"
          });
        }
        if (url.includes("/api/v1/map/catalog")) {
          return jsonResponse(testMapCatalogResponse());
        }
        if (url.includes("/api/v1/map/query")) {
          return jsonResponse(emptyMapQueryResponse(["reference.infrastructure.emergency"]));
        }
        return jsonResponse({ items: [] });
      })
    );

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("cop-map")).toBeTruthy());

    expect(screen.getByTestId("cop-map").getAttribute("data-focus-center")).toBe("17.38420,50.11870");
  });

  it("opens the mobile detail sheet when a map object is selected", async () => {
    const restoreMatchMedia = installMatchMedia(true);
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
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/sources")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/v1/cop/tracks?includeSynthetic=true")) {
        return jsonResponse({
          items: [
            {
              affiliation: "FRIEND",
              confidence: 0.82,
              domain: "AIR",
              objectId: "AIR_SIM_UAV-0001",
              objectType: "UAV",
              position: {
                lat: 50.09,
                lon: 14.43
              },
              status: "ACTIVE",
              synthetic: true
            }
          ]
        });
      }
      if (url.includes("/api/v1/cop/track-history?")) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ items: [] });
    });

    try {
      vi.stubGlobal("fetch", fetchMock);
      render(<App />);

      await waitFor(() => expect(screen.getByTestId("map-select-object-AIR_SIM_UAV-0001")).toBeTruthy());
      fireEvent.click(screen.getByTestId("map-select-object-AIR_SIM_UAV-0001"));

      const detailSheet = await screen.findByTestId("mobile-sheet-surface");
      expect(within(detailSheet).getByText("Detail objektu")).toBeTruthy();
      expect(within(detailSheet).getByText("Identita")).toBeTruthy();
      expect(within(detailSheet).getByText("Poloha")).toBeTruthy();
      expect(screen.getByTestId("cop-map").getAttribute("data-map-interaction-suspended")).toBe("true");
    } finally {
      restoreMatchMedia();
    }
  });

  it("keeps an empty connected map clean when no active tracks are present", async () => {
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

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/cop/tracks?includeSynthetic=true"),
        expect.any(Object)
      )
    );
    expect(screen.queryByText(/Datový zdroj je připojený/u)).toBeNull();
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network down");
      })
    );

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
      { groupId: "infrastructure", icon: "building-2", label: "Infrastruktura", order: 30 },
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
      },
      {
        audience: "public",
        defaultVisible: false,
        geometryTypes: ["Point"],
        groupId: "infrastructure",
        kind: "vector_features",
        label: "Bezpečnostní infrastruktura",
        layerId: "reference.infrastructure.emergency",
        query: {
          maxFeatures: 500,
          mode: "bbox",
          providerId: "sim.situation-data",
          providerLayerIds: ["ground"],
          providerSourceIds: ["reference.infrastructure.emergency"],
          streamId: "reference.infrastructure.emergency"
        },
        refreshSeconds: 3600,
        role: "reference",
        selectable: true,
        styleProfile: "reference-emergency-v1"
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

function emptyMapQueryResponse(layerIds: string[]): unknown {
  return {
    contractVersion: "cop-map-query-v1",
    generatedAt: "2026-05-19T08:00:00Z",
    query: {
      bbox: { east: 19.1, north: 51.2, south: 48.5, west: 12 },
      layerIds,
      limit: 500
    },
    summary: {
      featureCount: 0,
      layerCount: layerIds.length,
      warningCount: 0
    },
    warnings: []
  };
}

function installMatchMedia(matches: boolean): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn()
    }))
  });
  return () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: original
    });
  };
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
