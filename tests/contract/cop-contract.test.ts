import { describe, expect, it } from "vitest";
import { buildServer } from "../../apps/cop-api/src/server.js";
import simEvent from "./fixtures/sim-event.json" assert { type: "json" };

const authHeaders = {
  authorization: "Bearer dev-lab-token",
  "x-source-system-id": "sim-air-situation-001",
  "x-contract-version": "cop-ingest-v1",
  "x-correlation-id": "22222222-2222-4222-8222-222222222222"
};

function cloneEvent(overrides: Record<string, unknown> = {}) {
  return {
    ...structuredClone(simEvent),
    ...overrides
  };
}

describe("Shared Integration Contract v1", () => {
  it("accepts a valid single SIM event", async () => {
    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/events",
      headers: {
        ...authHeaders,
        "x-idempotency-key": "44444444-4444-4444-8444-444444444444"
      },
      payload: simEvent
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      accepted: true,
      eventId: simEvent.eventId,
      status: "QUEUED"
    });
  });

  it("accepts a valid batch", async () => {
    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/batches",
      headers: {
        ...authHeaders,
        "x-idempotency-key": "55555555-5555-4555-8555-555555555555"
      },
      payload: {
        batchId: "66666666-6666-4666-8666-666666666666",
        contractVersion: "cop-ingest-v1",
        sourceSystemId: "sim-air-situation-001",
        events: [simEvent]
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      acceptedCount: 1,
      rejectedCount: 0
    });
  });

  it("returns standard error envelope for schema errors", async () => {
    const app = buildServer();
    const invalid = cloneEvent();
    delete (invalid as { geo?: unknown }).geo;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/events",
      headers: {
        ...authHeaders,
        "x-idempotency-key": "77777777-7777-4777-8777-777777777777"
      },
      payload: invalid
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        correlationId: "22222222-2222-4222-8222-222222222222"
      }
    });
  });

  it("rejects unknown sourceSystemId", async () => {
    const app = buildServer();
    const unknownSourceEvent = cloneEvent({
      source: {
        ...simEvent.source,
        sourceSystemId: "unknown-source"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/events",
      headers: {
        ...authHeaders,
        "x-source-system-id": "unknown-source",
        "x-idempotency-key": "88888888-8888-4888-8888-888888888888"
      },
      payload: unknownSourceEvent
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("SOURCE_NOT_REGISTERED");
  });

  it("rejects event types outside Source Registry allow-list", async () => {
    const app = buildServer();
    const disallowed = cloneEvent({
      eventId: "99999999-9999-4999-8999-999999999999",
      eventType: "incident.created"
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/events",
      headers: {
        ...authHeaders,
        "x-idempotency-key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      },
      payload: disallowed
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("EVENT_TYPE_NOT_ALLOWED");
  });

  it("rejects revoked source", async () => {
    const app = buildServer();
    await app.inject({
      method: "POST",
      url: "/api/v1/sources/sim-air-situation-001/revoke",
      headers: {
        authorization: "Bearer dev-lab-token"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/events",
      headers: {
        ...authHeaders,
        "x-idempotency-key": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      },
      payload: simEvent
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("SOURCE_NOT_ACTIVE");
  });

  it("returns the same response for idempotent retry", async () => {
    const app = buildServer();
    const headers = {
      ...authHeaders,
      "x-idempotency-key": "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/events",
      headers,
      payload: simEvent
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/events",
      headers,
      payload: simEvent
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
  });

  it("detects idempotency conflict", async () => {
    const app = buildServer();
    const headers = {
      ...authHeaders,
      "x-idempotency-key": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    };

    await app.inject({
      method: "POST",
      url: "/api/v1/ingest/events",
      headers,
      payload: simEvent
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/events",
      headers,
      payload: cloneEvent({ eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("requires synthetic flag for SIM data", async () => {
    const app = buildServer();
    const missingSynthetic = cloneEvent({
      eventId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      simulation: {
        ...simEvent.simulation,
        synthetic: false
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ingest/events",
      headers: {
        ...authHeaders,
        "x-idempotency-key": "12121212-1212-4212-8212-121212121212"
      },
      payload: missingSynthetic
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("SYNTHETIC_FLAG_REQUIRED");
  });
});
