import { afterEach, describe, expect, it, vi } from "vitest";
import { FlightDataSourceAdapter } from "./flight-data-source.js";

describe("FlightDataSourceAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps SIM flight-data tracks into canonical COP events with public-flight metadata", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(sampleFlightResponse()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new FlightDataSourceAdapter({
      airportCacheTtlMs: 3600000,
      baseUrl: "https://sim.zeleznalady.cz/flight-data/",
      enabled: true,
      includeStale: true,
      limit: 5,
      pollMs: 0,
      source: "mock",
      timeoutMs: 6000
    });

    const result = await adapter.poll(new Date("2026-05-20T10:00:05Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.zeleznalady.cz/flight-data/api/v1/cop/tracks?limit=5&includeStale=true&source=mock");
    expect(result.health).toMatchObject({
      detail: "tracks 1, stale 0",
      health: "ONLINE"
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      classification: {
        handlingCaveats: ["PUBLIC_FLIGHT_AGGREGATE"],
        level: "UNCLASSIFIED"
      },
      contractVersion: "cop-ingest-v1",
      eventType: "track.updated",
      geo: {
        altitudeM: 2743,
        lat: 50.1174,
        lon: 14.5121
      },
      payload: {
        affiliation: "NEUTRAL",
        attributes: {
          dataOrigin: "PUBLIC_FLIGHT_AGGREGATE",
          flightData: {
            callsign: "CSA42",
            icao24: "4d2216",
            providers: [
              {
                licenseName: "Synthetic internal test data",
                mode: "mock",
                sourceId: "mock"
              }
            ],
            trackId: "flight:icao24:4d2216",
            trackKey: "4d2216",
            trackKeyKind: "icao24"
          }
        },
        objectId: "flight:icao24:4d2216",
        objectType: "AIRCRAFT",
        status: "ACTIVE",
        synthetic: false
      },
      quality: {
        confidence: 0.84,
        informationCredibility: "3",
        sourceReliability: "C"
      },
      source: {
        adapterId: "flight-data-source-adapter",
        sourceDeviceId: "mock",
        sourceSystemId: "flight-data-api"
      }
    });
    expect(result.events[0]?.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("proxies and caches airport reference data from SIM flight-data", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(sampleAirportResponse()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new FlightDataSourceAdapter({
      airportCacheTtlMs: 3600000,
      baseUrl: "https://sim.zeleznalady.cz/flight-data/",
      enabled: true,
      includeStale: true,
      limit: 5,
      pollMs: 0,
      timeoutMs: 6000
    });

    const first = await adapter.fetchAirports({ limit: 1, query: "LKPR" }, new Date("2026-05-20T10:00:05Z"));
    const second = await adapter.fetchAirports({ limit: 1, query: "LKPR" }, new Date("2026-05-20T10:00:10Z"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.zeleznalady.cz/flight-data/api/v1/airports?limit=1&query=LKPR");
    expect(first).toEqual(second);
    expect(first.items[0]).toMatchObject({
      dataSource: "ourairports:airports.csv",
      ident: "LKPR",
      iata: "PRG",
      name: "Václav Havel Airport Prague",
      type: "large_airport"
    });
  });
});

function sampleFlightResponse() {
  return {
    contractVersion: "cop-flight-source-v1",
    source: {
      generatedAt: "2026-05-20T10:00:00.000Z",
      sourceId: "flight-data-api",
      sourceType: "PUBLIC_FLIGHT_AGGREGATE"
    },
    sources: [
      {
        enabled: true,
        label: "Synthetic local flight feed",
        license: {
          attribution: "SIM flight data",
          name: "Synthetic internal test data"
        },
        mode: "mock",
        priority: 10,
        sourceId: "mock"
      }
    ],
    summary: {
      deduplicatedTrackCount: 1,
      rawObservationCount: 1,
      staleTrackCount: 0
    },
    tracks: [
      {
        aircraft: {
          manufacturer: "Airbus",
          model: "A320",
          typeDesignator: "A320"
        },
        altitudeM: 2743,
        callsign: "CSA42",
        deduplication: {
          key: "icao24",
          mergedRecordCount: 1,
          primarySourceId: "mock"
        },
        domain: "AIR",
        headingDeg: 268,
        icao24: "4d2216",
        lastSeenAt: "2026-05-20T10:00:00.000Z",
        lat: 50.1174,
        lon: 14.5121,
        objectType: "AIRCRAFT",
        originCountry: "Czech Republic",
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
        ],
        speedMps: 138,
        trackId: "flight:icao24:4d2216",
        trackKey: "4d2216",
        trackKeyKind: "icao24",
        verticalRateMps: 2.1
      }
    ],
    warnings: []
  };
}

function sampleAirportResponse() {
  return {
    items: [
      {
        countryCode: "CZ",
        dataSource: "ourairports:airports.csv",
        elevationFt: 1247,
        iata: "PRG",
        ident: "LKPR",
        lat: 50.100874,
        lon: 14.259911,
        municipality: "Prague",
        name: "Václav Havel Airport Prague",
        type: "large_airport"
      }
    ],
    source: {
      label: "OurAirports airport reference data",
      license: "Public domain compatible",
      loadedAt: "2026-05-20T18:43:46.000Z",
      warnings: []
    },
    summary: {
      totalReferenceAirports: 2467
    }
  };
}
