import { describe, expect, it } from "vitest";
import type { CanonicalEventEnvelope } from "@cop/canonical-model";
import { buildServer } from "./server.js";

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
});

async function ingestTrack(app: ReturnType<typeof buildServer>, eventId: string, timestamp: string, lat: number, lon: number) {
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
      affiliation: "HOSTILE",
      domain: "AIR",
      objectId: "AIR_SIM_UAV-0001",
      objectType: "UAV",
      position: { lat, lon },
      status: "ACTIVE"
    },
    producerTimestamp: timestamp,
    quality: {
      confidence: 0.87,
      informationCredibility: "2",
      sourceReliability: "B"
    },
    simulation: {
      synthetic: true
    },
    source: {
      adapterId: "sim-adapter",
      adapterVersion: "0.1.0",
      sourceSystemId: "sim-air-situation-001"
    }
  };

  const response = await app.inject({
    headers: {
      authorization: "Bearer dev-lab-token",
      "x-contract-version": "cop-ingest-v1",
      "x-idempotency-key": eventId,
      "x-source-system-id": "sim-air-situation-001"
    },
    method: "POST",
    payload: event,
    url: "/api/v1/ingest/events"
  });

  expect(response.statusCode).toBe(202);
}
