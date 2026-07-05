import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import type { PlaceGeocodeQuery, PlaceGeocodeResponse, PlaceGeocoder } from "./place-geocoder.js";

describe("place geocoder routes", () => {
  it("returns place search results through the COP API", async () => {
    const geocoder = new FakePlaceGeocoder();
    const app = buildServer({
      now: () => new Date("2026-05-23T08:00:00Z"),
      placeGeocoder: geocoder
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/geocode/search?q=Kyjev&limit=3&bbox=13.5,49.5,15.5,50.5&bounded=1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      contractVersion: "cop-geocode-v1",
      items: [
        {
          center: [30.5234, 50.4501],
          displayName: "Kyjev, Ukrajina",
          id: "test:kyiv",
          providerId: "test-geocoder",
          zoomHint: 10
        }
      ],
      query: {
        bbox: {
          east: 15.5,
          north: 50.5,
          south: 49.5,
          west: 13.5
        },
        bounded: true,
        limit: 3,
        q: "Kyjev"
      }
    });
    expect(geocoder.lastQuery).toMatchObject({
      bbox: {
        east: 15.5,
        north: 50.5,
        south: 49.5,
        west: 13.5
      },
      bounded: true,
      query: "Kyjev"
    });

    await app.close();
  });
});

class FakePlaceGeocoder implements PlaceGeocoder {
  readonly providerId = "test-geocoder";
  lastQuery: PlaceGeocodeQuery | null = null;

  async search(query: PlaceGeocodeQuery, now: Date): Promise<PlaceGeocodeResponse> {
    this.lastQuery = query;
    return {
      cache: {
        key: query.query,
        status: "miss",
        ttlSeconds: 60
      },
      contractVersion: "cop-geocode-v1",
      items: [{
        center: [30.5234, 50.4501],
        displayName: "Kyjev, Ukrajina",
        id: "test:kyiv",
        kind: "city",
        providerId: this.providerId,
        subtitle: "město",
        zoomHint: 10
      }],
      providerId: this.providerId,
      query: {
        ...(query.bbox ? { bbox: query.bbox } : {}),
        ...(query.bounded ? { bounded: query.bounded } : {}),
        language: query.language ?? "cs,en",
        limit: query.limit ?? 5,
        q: query.query
      },
      serverTimestamp: now.toISOString(),
      warnings: []
    };
  }
}
