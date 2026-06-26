import { describe, expect, it } from "vitest";
import { createPublicFlightAggregateSourceSystem, type Affiliation, type CanonicalEventEnvelope, type ObjectStatus, type ObservedObject } from "@cop/canonical-model";
import type { CopStreamBus, CopStreamBusMetrics } from "./cop-stream-bus.js";
import type { CopStreamMessage } from "./cop-stream.js";
import type { FlightDataSource } from "./flight-data-source.js";
import { buildServer } from "./server.js";
import type { TrackHistoryStore } from "./track-history-store.js";
import type { TrackHistoryQuery } from "./temporal-history.js";
import type { TrackHistoryPoint } from "./types.js";

describe("COP state temporal history", () => {
  it("records track history from accepted ingest events and filters it by seconds", async () => {
    const app = buildServer({ now: () => new Date("2026-05-19T08:02:10Z") });

    await ingestTrack(app, "00000000-0000-4000-8000-000000000001", "2026-05-19T08:00:00Z", 50, 14);
    await ingestTrack(app, "00000000-0000-4000-8000-000000000002", "2026-05-19T08:01:30Z", 50.01, 14.01);
    await ingestTrack(app, "00000000-0000-4000-8000-000000000003", "2026-05-19T08:02:00Z", 50.02, 14.02);

    const response = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/track-history?objectIds=AIR_SIM_UAV-0001&seconds=60&limit=10"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ objectId: string; points: Array<{ lat: number; timestamp: string }> }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.points.map((point) => point.timestamp)).toEqual([
      "2026-05-19T08:01:30Z",
      "2026-05-19T08:02:00Z"
    ]);
    expect(body.items[0]?.points.map((point) => point.lat)).toEqual([50.01, 50.02]);
  });

  it("applies the per-track history limit", async () => {
    const app = buildServer({ now: () => new Date("2026-05-19T08:02:10Z") });

    await ingestTrack(app, "00000000-0000-4000-8000-000000000004", "2026-05-19T08:00:00Z", 50, 14);
    await ingestTrack(app, "00000000-0000-4000-8000-000000000005", "2026-05-19T08:01:00Z", 50.01, 14.01);

    const response = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/track-history?limit=1"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ points: Array<{ timestamp: string }> }> };
    expect(body.items[0]?.points).toHaveLength(1);
    expect(body.items[0]?.points[0]?.timestamp).toBe("2026-05-19T08:01:00Z");
  });

  it("writes accepted track points to the configured persistent history store", async () => {
    const store = new FakeTrackHistoryStore();
    const app = buildServer({
      now: () => new Date("2026-05-19T08:02:10Z"),
      trackHistoryStore: store
    });

    await ingestTrack(app, "00000000-0000-4000-8000-000000000006", "2026-05-19T08:01:00Z", 50.03, 14.03);

    const response = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/track-history?objectIds=AIR_SIM_UAV-0001&seconds=90&limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(store.initCalled).toBe(true);
    expect(store.appended).toHaveLength(1);
    expect(store.current.get("AIR_SIM_UAV-0001")?.position?.lat).toBe(50.03);
    expect(store.queryCalls).toBe(1);
    expect(response.json()).toMatchObject({
      items: [
        {
          objectId: "AIR_SIM_UAV-0001",
          points: [
            {
              lat: 50.03,
              lon: 14.03,
              objectId: "AIR_SIM_UAV-0001"
            }
          ]
        }
      ]
    });

    await app.close();
  });

  it("publishes accepted ingest deltas through the configured stream bus", async () => {
    const streamBus = new FakeStreamBus();
    const app = buildServer({
      now: () => new Date("2026-05-19T08:02:10Z"),
      streamBus
    });

    await ingestTrack(app, "00000000-0000-4000-8000-000000000900", "2026-05-19T08:01:00Z", 50.04, 14.04);

    expect(streamBus.published).toHaveLength(1);
    expect(streamBus.published[0]).toMatchObject({
      changes: [
        {
          changeType: "OBJECT_UPSERT",
          object: {
            objectId: "AIR_SIM_UAV-0001",
            position: {
              lat: 50.04,
              lon: 14.04
            }
          }
        }
      ],
      type: "delta"
    });

    await app.close();
  });

  it("restores current tracks from the configured persistent store on startup", async () => {
    const store = new FakeTrackHistoryStore([
      {
        affiliation: "HOSTILE",
        confidence: 0.9,
        domain: "AIR",
        lastUpdatedAt: "2026-05-19T08:02:00Z",
        objectId: "AIR_SIM_UAV-RESTORED",
        objectType: "UAV",
        position: { lat: 50.05, lon: 14.05 },
        status: "ACTIVE",
        synthetic: true
      }
    ]);
    const app = buildServer({
      now: () => new Date("2026-05-19T08:02:10Z"),
      trackHistoryStore: store
    });

    const response = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/tracks"
    });

    expect(response.statusCode).toBe(200);
    expect(store.loadCurrentCalls).toBe(1);
    expect(response.json()).toMatchObject({
      items: [
        {
          objectId: "AIR_SIM_UAV-RESTORED",
          position: {
            lat: 50.05,
            lon: 14.05
          }
        }
      ]
    });

    await app.close();
  });

  it("reports source health and object provenance for accepted events", async () => {
    const app = buildServer({ now: () => new Date("2026-05-19T08:02:10Z") });

    await ingestTrack(app, "00000000-0000-4000-8000-000000000007", "2026-05-19T08:02:00Z", 50.04, 14.04);

    const healthResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/sources/health"
    });
    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toMatchObject({
      items: [
        {
          acceptedEvents: 1,
          currentTracks: 1,
          health: "ONLINE",
          sourceSystemId: "sim-air-situation-001",
          totalTracks: 1
        }
      ]
    });

    const tracksResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/tracks"
    });
    expect(tracksResponse.statusCode).toBe(200);
    expect(tracksResponse.json()).toMatchObject({
      items: [
        {
          attributes: {
            provenance: {
              adapterId: "sim-adapter",
              eventId: "00000000-0000-4000-8000-000000000007",
              sourceSystemId: "sim-air-situation-001"
            }
          },
          objectId: "AIR_SIM_UAV-0001"
        }
      ]
    });
  });

  it("polls the public flight data source into current tracks, history, and source health", async () => {
    const flightSource = new FakeFlightDataSource();
    const app = buildServer({
      flightDataSource: flightSource,
      now: () => new Date("2026-05-20T10:00:05Z")
    });

    const tracksResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/tracks"
    });

    expect(tracksResponse.statusCode).toBe(200);
    expect(flightSource.pollCalls).toBe(1);
    expect(tracksResponse.json()).toMatchObject({
      items: [
        {
          affiliation: "NEUTRAL",
          attributes: {
            flightData: {
              icao24: "4d2216",
              providers: [
                {
                  mode: "mock",
                  sourceId: "mock"
                }
              ]
            },
            provenance: {
              adapterId: "flight-data-source-adapter",
              sourceDeviceId: "mock",
              sourceSystemId: "flight-data-api"
            }
          },
          objectId: "flight:icao24:4d2216",
          objectType: "AIRCRAFT",
          synthetic: false
        }
      ]
    });

    const historyResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/track-history?objectIds=flight:icao24:4d2216&seconds=60"
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json()).toMatchObject({
      items: [
        {
          objectId: "flight:icao24:4d2216",
          points: [
            {
              lat: 50.1174,
              lon: 14.5121,
              sourceSystemId: "flight-data-api"
            }
          ]
        }
      ]
    });

    const healthResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/sources/health"
    });

    expect(healthResponse.statusCode).toBe(200);
    expect((healthResponse.json() as { items: unknown[] }).items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        acceptedEvents: 1,
        currentTracks: 1,
        health: "ONLINE",
        sourceSystemId: "flight-data-api",
        sourceType: "PUBLIC_FLIGHT_AGGREGATE",
        totalTracks: 1
      })
    ]));

    await app.close();
  });

  it("returns server-side conflict evidence and decorates current tracks", async () => {
    const app = buildServer({ now: () => new Date("2026-05-19T08:02:10Z") });

    await ingestTrack(app, "00000000-0000-4000-8000-000000000008", "2026-05-19T08:01:00Z", 50.04, 14.04, {
      affiliation: "HOSTILE"
    });
    await ingestTrack(app, "00000000-0000-4000-8000-000000000009", "2026-05-19T08:02:00Z", 50.05, 14.05, {
      affiliation: "FRIEND"
    });

    const conflictsResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/conflicts?objectIds=AIR_SIM_UAV-0001&seconds=300&limit=10"
    });
    expect(conflictsResponse.statusCode).toBe(200);
    expect(conflictsResponse.json()).toMatchObject({
      items: [
        {
          objectId: "AIR_SIM_UAV-0001",
          state: "CONFLICTED",
          signals: [
            {
              title: "Affiliation variance",
              type: "AFFILIATION_VARIANCE"
            }
          ]
        }
      ]
    });

    const tracksResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/tracks"
    });
    expect(tracksResponse.statusCode).toBe(200);
    expect(tracksResponse.json()).toMatchObject({
      items: [
        {
          attributes: {
            conflictEvidence: {
              state: "CONFLICTED",
              signals: [
                {
                  type: "AFFILIATION_VARIANCE"
                }
              ]
            }
          },
          objectId: "AIR_SIM_UAV-0001"
        }
      ]
    });
  });

  it("derives operational alerts and supports acknowledgement", async () => {
    const app = buildServer({ now: () => new Date("2026-05-19T08:02:10Z") });

    await ingestTrack(app, "00000000-0000-4000-8000-000000000010", "2026-05-19T08:02:00Z", 50.04, 14.04, {
      confidence: 0.34
    });

    const alertsResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/alerts"
    });
    expect(alertsResponse.statusCode).toBe(200);
    const alertsBody = alertsResponse.json() as { items: Array<{ alertId: string; objectId?: string; status: string; type: string }> };
    const lowConfidenceAlert = alertsBody.items.find((alert) => alert.type === "LOW_CONFIDENCE");
    expect(lowConfidenceAlert).toMatchObject({
      objectId: "AIR_SIM_UAV-0001",
      status: "ACTIVE"
    });

    const acknowledgementResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "POST",
      payload: {
        note: "checked"
      },
      url: `/api/v1/cop/alerts/${lowConfidenceAlert!.alertId}/acknowledge`
    });
    expect(acknowledgementResponse.statusCode).toBe(200);
    expect(acknowledgementResponse.json()).toMatchObject({
      alertId: lowConfidenceAlert!.alertId,
      status: "ACKNOWLEDGED"
    });

    const activeOnlyResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/alerts"
    });
    expect((activeOnlyResponse.json() as { items: Array<{ alertId: string }> }).items.some((alert) => alert.alertId === lowConfidenceAlert!.alertId)).toBe(
      false
    );

    const withAcknowledgedResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/alerts?includeAcknowledged=true"
    });
    const acknowledgedItems = (withAcknowledgedResponse.json() as { items: Array<{ alertId: string; status: string }> }).items;
    expect(acknowledgedItems.find((alert) => alert.alertId === lowConfidenceAlert!.alertId)).toMatchObject({
      alertId: lowConfidenceAlert!.alertId,
      status: "ACKNOWLEDGED"
    });
  });

  it("derives AOI entry alerts from user profile rules", async () => {
    const app = buildServer({ now: () => new Date("2026-05-19T08:02:10Z") });

    const preferencesResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "PUT",
      payload: {
        alertPreferences: {
          aoiRules: [
            {
              affiliationScope: "hostile",
              enabled: true,
              id: "hq-aoi",
              lat: 50.04,
              lon: 14.04,
              name: "HQ AOI",
              radiusKm: 2,
              severity: "warning"
            }
          ]
        },
        preferences: {}
      },
      url: "/api/v1/me/preferences"
    });
    expect(preferencesResponse.statusCode).toBe(200);

    await ingestTrack(app, "00000000-0000-4000-8000-000000000011", "2026-05-19T08:02:00Z", 50.045, 14.045, {
      affiliation: "HOSTILE"
    });

    const alertsResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/alerts"
    });

    expect(alertsResponse.statusCode).toBe(200);
    const alert = (alertsResponse.json() as { items: Array<{ evidence?: Record<string, unknown>; map?: { radiusKm: number }; objectId?: string; type: string }> }).items.find(
      (item) => item.type === "AOI_ENTRY"
    );
    expect(alert).toMatchObject({
      objectId: "AIR_SIM_UAV-0001",
      map: {
        radiusKm: 2
      }
    });
    expect(alert?.evidence).toMatchObject({
      affiliationScope: "hostile",
      aoiName: "HQ AOI",
      aoiRuleId: "hq-aoi"
    });
  });

  it("derives AOI entry alerts from polygon user profile rules", async () => {
    const app = buildServer({ now: () => new Date("2026-05-19T08:02:10Z") });

    const preferencesResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "PUT",
      payload: {
        alertPreferences: {
          aoiRules: [
            {
              affiliationScope: "hostile",
              enabled: true,
              id: "polygon-aoi",
              lat: 50.045,
              lon: 14.045,
              name: "Polygon AOI",
              polygon: {
                type: "Polygon",
                coordinates: [
                  [
                    [14.03, 50.03],
                    [14.06, 50.03],
                    [14.06, 50.06],
                    [14.03, 50.06],
                    [14.03, 50.03]
                  ]
                ]
              },
              radiusKm: 1,
              severity: "warning"
            }
          ]
        },
        preferences: {}
      },
      url: "/api/v1/me/preferences"
    });
    expect(preferencesResponse.statusCode).toBe(200);

    await ingestTrack(app, "00000000-0000-4000-8000-000000000013", "2026-05-19T08:02:00Z", 50.05, 14.05, {
      affiliation: "HOSTILE"
    });

    const alertsResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/cop/alerts"
    });

    expect(alertsResponse.statusCode).toBe(200);
    const alert = (alertsResponse.json() as { items: Array<{ evidence?: Record<string, unknown>; objectId?: string; type: string }> }).items.find(
      (item) => item.type === "AOI_ENTRY"
    );
    expect(alert).toMatchObject({
      objectId: "AIR_SIM_UAV-0001"
    });
    expect(alert?.evidence).toMatchObject({
      aoiName: "Polygon AOI",
      geometryType: "Polygon"
    });
  });

  it("returns a native mobile bootstrap payload with profile, config and offline snapshot", async () => {
    const app = buildServer({ now: () => new Date("2026-05-19T08:02:10Z") });

    await ingestTrack(app, "00000000-0000-4000-8000-000000000012", "2026-05-19T08:02:00Z", 50.04, 14.04, {
      affiliation: "HOSTILE"
    });

    const response = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token"
      },
      method: "GET",
      url: "/api/v1/mobile/bootstrap?seconds=90&limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      actor: {
        subjectId: "lab"
      },
      capabilities: {
        bootstrap: true,
        offlineSnapshot: true,
        sseStream: true
      },
      endpoints: {
        offlineSnapshot: "/api/v1/mobile/offline-snapshot",
        stream: "/api/v1/stream/cop/live"
      },
      map: {
        glyphsTemplateUrl: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        styleUrl: "",
        tileTemplateUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      },
      policy: {
        offlineCacheTtlSeconds: 900
      },
      snapshot: {
        cachePolicy: {
          mode: "read-only"
        },
        objects: [
          {
            objectId: "AIR_SIM_UAV-0001"
          }
        ],
        trackHistory: [
          {
            objectId: "AIR_SIM_UAV-0001",
            points: [
              {
                lat: 50.04,
                lon: 14.04
              }
            ]
          }
        ]
      }
    });
    expect((response.json() as { snapshot: { snapshotId: string } }).snapshot.snapshotId).toHaveLength(32);
  });

  it("registers native mobile devices for future device policy and push integration", async () => {
    const app = buildServer({ now: () => new Date("2026-05-19T08:02:10Z") });

    const response = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token",
        "x-correlation-id": "mobile-registration-test"
      },
      method: "POST",
      payload: {
        appVersion: "0.1.0",
        buildNumber: "42",
        capabilities: ["offlineSnapshot", "sseStream"],
        deviceId: "ios-device-001",
        deviceModel: "iPad14,3",
        osVersion: "18.5",
        platform: "ipados",
        pushToken: "apns-token-redacted-in-response"
      },
      url: "/api/v1/mobile/devices"
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      actor: {
        subjectId: "lab"
      },
      device: {
        appVersion: "0.1.0",
        buildNumber: "42",
        capabilities: ["offlineSnapshot", "sseStream"],
        deviceId: "ios-device-001",
        deviceModel: "iPad14,3",
        osVersion: "18.5",
        platform: "ipados",
        pushTokenRegistered: true,
        subjectId: "lab"
      },
      policy: {
        pushNotifications: "not_configured"
      }
    });
    expect(JSON.stringify(response.json())).not.toContain("apns-token-redacted-in-response");
  });
});

class FakeTrackHistoryStore implements TrackHistoryStore {
  readonly name = "fake";
  appended: TrackHistoryPoint[] = [];
  current = new Map<string, ObservedObject>();
  initCalled = false;
  loadCurrentCalls = 0;
  queryCalls = 0;

  constructor(currentObjects: ObservedObject[] = []) {
    for (const object of currentObjects) {
      this.current.set(object.objectId, object);
    }
  }

  async init(): Promise<void> {
    this.initCalled = true;
  }

  async append(point: TrackHistoryPoint): Promise<void> {
    this.appended.push(point);
  }

  async upsertCurrent(object: ObservedObject, _event: CanonicalEventEnvelope): Promise<void> {
    this.current.set(object.objectId, object);
  }

  async loadCurrent(): Promise<ObservedObject[]> {
    this.loadCurrentCalls += 1;
    return Array.from(this.current.values());
  }

  async query(_query: TrackHistoryQuery, _now: Date): Promise<Array<{ objectId: string; points: TrackHistoryPoint[] }>> {
    this.queryCalls += 1;
    return [
      {
        objectId: "AIR_SIM_UAV-0001",
        points: this.appended
      }
    ];
  }

  async count(): Promise<number> {
    return this.appended.length;
  }

  async countCurrent(): Promise<number> {
    return this.current.size;
  }

  async close(): Promise<void> {}
}

class FakeFlightDataSource implements FlightDataSource {
  readonly config = {
    airportCacheTtlMs: 3600000,
    baseUrl: "https://sim.zeleznalady.cz/flight-data",
    enabled: true,
    includeStale: true,
    limit: 500,
    pollMs: 0,
    source: "mock",
    timeoutMs: 6000
  };

  readonly sourceSystem = createPublicFlightAggregateSourceSystem();

  pollCalls = 0;

  async poll(pollNow: Date) {
    this.pollCalls += 1;
    const event: CanonicalEventEnvelope = {
      classification: {
        handlingCaveats: ["PUBLIC_FLIGHT_AGGREGATE"],
        level: "UNCLASSIFIED",
        releasability: ["CZ"]
      },
      contractVersion: "cop-ingest-v1",
      correlationId: "70000000-0000-5000-8000-000000000001",
      eventId: "70000000-0000-5000-8000-000000000002",
      eventType: "track.updated",
      geo: {
        altitudeM: 2743,
        lat: 50.1174,
        lon: 14.5121
      },
      ingestTimestamp: pollNow.toISOString(),
      payload: {
        affiliation: "NEUTRAL",
        attributes: {
          dataOrigin: "PUBLIC_FLIGHT_AGGREGATE",
          flightData: {
            icao24: "4d2216",
            providers: [
              {
                enabled: true,
                label: "Synthetic local flight feed",
                licenseName: "Synthetic internal test data",
                mode: "mock",
                sourceId: "mock"
              }
            ],
            quality: {
              confidence: 0.84,
              positionAgeSeconds: 0,
              stale: false
            },
            registration: "OK-TSR",
            sources: [
              {
                sourceId: "mock",
                sourceRecordId: "mock:4d2216:adsb"
              }
            ]
          }
        },
        confidence: 0.84,
        domain: "AIR",
        headingDeg: 268,
        objectId: "flight:icao24:4d2216",
        objectType: "AIRCRAFT",
        position: {
          altitudeM: 2743,
          lat: 50.1174,
          lon: 14.5121
        },
        speedMps: 138,
        status: "ACTIVE",
        synthetic: false
      },
      producerTimestamp: "2026-05-20T10:00:00Z",
      quality: {
        confidence: 0.84,
        informationCredibility: "3",
        sourceReliability: "C"
      },
      source: {
        adapterId: "flight-data-source-adapter",
        adapterVersion: "0.1.0",
        sourceDeviceId: "mock",
        sourceSystemId: "flight-data-api"
      }
    };
    return {
      events: [event],
      health: {
        detail: "tracks 1, stale 0",
        evaluatedAt: pollNow.toISOString(),
        generatedAt: "2026-05-20T10:00:00Z",
        health: "ONLINE" as const,
        lastPollAt: pollNow.toISOString(),
        lastSuccessAt: pollNow.toISOString(),
        summary: {
          deduplicatedTrackCount: 1,
          staleTrackCount: 0
        },
        warnings: []
      },
      response: {
        contractVersion: "cop-flight-source-v1" as const,
        source: {
          generatedAt: "2026-05-20T10:00:00Z",
          sourceId: "flight-data-api",
          sourceType: "PUBLIC_FLIGHT_AGGREGATE" as const
        },
        sources: [
          {
            enabled: true,
            label: "Synthetic local flight feed",
            mode: "mock",
            sourceId: "mock"
          }
        ],
        summary: {
          deduplicatedTrackCount: 1,
          rawObservationCount: 1,
          staleTrackCount: 0
        },
        tracks: [],
        warnings: []
      }
    };
  }
}

class FakeStreamBus implements CopStreamBus {
  readonly name = "fake";
  readonly published: CopStreamMessage[] = [];
  private readonly subscribers = new Set<(message: CopStreamMessage) => void>();

  get metrics(): CopStreamBusMetrics {
    return {
      localDeliveriesTotal: this.published.length,
      mode: this.name,
      publishedMessagesTotal: this.published.length,
      ready: true,
      receivedMessagesTotal: 0
    };
  }

  async init(): Promise<void> {}

  async close(): Promise<void> {
    this.subscribers.clear();
  }

  diagnostics(): string {
    return "fake: ready";
  }

  async publish(message: CopStreamMessage): Promise<void> {
    this.published.push(message);
    for (const subscriber of Array.from(this.subscribers)) {
      subscriber(message);
    }
  }

  subscribe(subscriber: (message: CopStreamMessage) => void): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }
}

async function ingestTrack(
  app: ReturnType<typeof buildServer>,
  eventId: string,
  timestamp: string,
  lat: number,
  lon: number,
  options: {
    affiliation?: Affiliation;
    confidence?: number;
    sourceSystemId?: string;
    status?: ObjectStatus;
  } = {}
) {
  const sourceSystemId = options.sourceSystemId ?? "sim-air-situation-001";
  const event: CanonicalEventEnvelope = {
    classification: {
      handlingCaveats: [],
      level: "UNCLASSIFIED",
      releasability: ["CZ"]
    },
    contractVersion: "cop-ingest-v1",
    correlationId: "10000000-0000-4000-8000-000000000001",
    eventId,
    eventType: "track.updated",
    geo: { lat, lon },
    ingestTimestamp: timestamp,
    payload: {
      affiliation: options.affiliation ?? "HOSTILE",
      domain: "AIR",
      objectId: "AIR_SIM_UAV-0001",
      objectType: "UAV",
      position: { lat, lon },
      status: options.status ?? "ACTIVE"
    },
    producerTimestamp: timestamp,
    quality: {
      confidence: options.confidence ?? 0.87,
      informationCredibility: "2",
      sourceReliability: "B"
    },
    simulation: {
      synthetic: true
    },
    source: {
      adapterId: "sim-adapter",
      adapterVersion: "0.1.0",
      sourceSystemId
    }
  };

  const response = await app.inject({
    headers: {
      authorization: "Bearer dev-lab-token",
      "x-contract-version": "cop-ingest-v1",
      "x-idempotency-key": eventId,
      "x-source-system-id": sourceSystemId
    },
    method: "POST",
    payload: event,
    url: "/api/v1/ingest/events"
  });

  expect(response.statusCode).toBe(202);
}
