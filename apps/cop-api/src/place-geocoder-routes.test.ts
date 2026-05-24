import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import type { PlaceGeocodeQuery, PlaceGeocodeResponse, PlaceGeocoder } from "./place-geocoder.js";

describe("place geocoder routes", () => {
  it("returns place search results through the COP API", async () => {
    const app = buildServer({
      now: () => new Date("2026-05-23T08:00:00Z"),
      placeGeocoder: new FakePlaceGeocoder()
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/geocode/search?q=Kyjev&limit=3"
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
        limit: 3,
        q: "Kyjev"
      }
    });

    await app.close();
  });
});

class FakePlaceGeocoder implements PlaceGeocoder {
  readonly providerId = "test-geocoder";

  async search(query: PlaceGeocodeQuery, now: Date): Promise<PlaceGeocodeResponse> {
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
        language: query.language ?? "cs,en",
        limit: query.limit ?? 5,
        q: query.query
      },
      serverTimestamp: now.toISOString(),
      warnings: []
    };
  }
}
