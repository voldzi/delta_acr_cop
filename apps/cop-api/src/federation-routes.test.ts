import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";

const authHeaders = {
  authorization: "Bearer dev-lab-token"
};
const originalEnv = { ...process.env };

describe("federation runtime routes", () => {
  beforeEach(() => {
    vi.stubEnv("COP_CSM_MESSAGING_ENABLED", "false");
    vi.stubEnv("COP_FLIGHT_DATA_ENABLED", "false");
    vi.stubEnv("COP_FEDERATION_STORE", "memory");
    vi.stubEnv("COP_MISSION_ARENA_ENABLED", "false");
    vi.stubEnv("COP_SAFETY_DATA_ENABLED", "false");
    vi.stubEnv("COP_SITUATION_DATA_ENABLED", "false");
    vi.stubEnv("COP_TAK_GATEWAY_ENABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
  });

  it("lists registered federation nodes only for authenticated callers", async () => {
    const app = buildServer({ now: () => new Date("2026-06-19T12:00:00Z") });
    try {
      const unauthenticated = await app.inject({
        method: "GET",
        url: "/api/v1/federation/nodes"
      });
      expect(unauthenticated.statusCode).toBe(401);

      const response = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: "/api/v1/federation/nodes"
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        contractVersion: "cop-federation-node-list-v1",
        items: expect.arrayContaining([
          expect.objectContaining({
            nodeId: "node_central_cop",
            nodeRole: "central-orchestrator"
          })
        ])
      });
    } finally {
      await app.close();
    }
  });

  it("accepts a domain event and replays it by offset", async () => {
    const app = buildServer({ now: () => new Date("2026-06-19T12:00:00Z") });
    try {
      const publishResponse = await app.inject({
        headers: {
          ...authHeaders,
          "x-correlation-id": "corr-test-domain-event"
        },
        method: "POST",
        payload: {
          entityId: "incident-test-1",
          entityType: "incident",
          payload: {
            title: "Test incident"
          },
          producerNodeId: "node_central_cop",
          releasePolicy: {
            allowedScopes: ["event"],
            visibility: "event"
          },
          type: "incident.created"
        },
        url: "/api/v1/events/domain"
      });
      expect(publishResponse.statusCode).toBe(202);
      expect(publishResponse.json()).toMatchObject({
        accepted: true,
        event: {
          channel: "cop.domain.events",
          data: {
            contractVersion: "cop-domain-event-v1",
            correlationId: "corr-test-domain-event",
            entityId: "incident-test-1",
            producerNodeId: "node_central_cop"
          },
          replayOffset: 1,
          specversion: "1.0",
          type: "incident.created"
        }
      });

      const replayResponse = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: "/api/v1/events/domain?fromOffset=0&limit=10&type=incident.created"
      });
      expect(replayResponse.statusCode).toBe(200);
      expect(replayResponse.json()).toMatchObject({
        contractVersion: "cop-domain-event-replay-v1",
        items: [
          expect.objectContaining({
            replayOffset: 1,
            type: "incident.created"
          })
        ],
        nextOffset: 1,
        summary: {
          count: 1,
          totalAvailable: 1
        }
      });
    } finally {
      await app.close();
    }
  });

  it("sends unknown producer events to dead-letter queue", async () => {
    const app = buildServer({ now: () => new Date("2026-06-19T12:00:00Z") });
    try {
      const publishResponse = await app.inject({
        headers: {
          ...authHeaders,
          "x-correlation-id": "corr-dead-letter"
        },
        method: "POST",
        payload: {
          entityId: "incident-test-2",
          entityType: "incident",
          payload: {
            title: "Rejected incident"
          },
          producerNodeId: "node_missing",
          type: "incident.created"
        },
        url: "/api/v1/events/domain"
      });
      expect(publishResponse.statusCode).toBe(422);

      const dlqResponse = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: "/api/v1/events/dead-letter"
      });
      expect(dlqResponse.statusCode).toBe(200);
      expect(dlqResponse.json()).toMatchObject({
        contractVersion: "cop-domain-event-dlq-v1",
        items: [
          expect.objectContaining({
            correlationId: "corr-dead-letter",
            errorCode: "UNKNOWN_PRODUCER_NODE"
          })
        ],
        summary: {
          count: 1,
          totalAvailable: 1
        }
      });
    } finally {
      await app.close();
    }
  });

  it("registers a new edge node heartbeat", async () => {
    const app = buildServer({ now: () => new Date("2026-06-19T12:00:00Z") });
    try {
      const heartbeatResponse = await app.inject({
        headers: authHeaders,
        method: "POST",
        payload: {
          capabilities: ["offline-outbox", "domain-events"],
          classificationMax: "INTERNAL",
          health: "ok",
          nodeName: "iPad field node",
          nodeRole: "edge-node",
          softwareVersion: "0.1.0"
        },
        url: "/api/v1/federation/nodes/node_edge_ipad_01/heartbeat"
      });
      expect(heartbeatResponse.statusCode).toBe(201);
      expect(heartbeatResponse.json()).toMatchObject({
        capabilities: ["offline-outbox", "domain-events"],
        health: "ok",
        nodeId: "node_edge_ipad_01",
        nodeRole: "edge-node"
      });
    } finally {
      await app.close();
    }
  });

  it("flushes edge outbox events idempotently", async () => {
    const app = buildServer({ now: () => new Date("2026-06-19T12:00:00Z") });
    try {
      await app.inject({
        headers: authHeaders,
        method: "POST",
        payload: {
          capabilities: ["offline-outbox", "domain-events"],
          classificationMax: "INTERNAL",
          health: "ok",
          nodeName: "offline iPad",
          nodeRole: "edge-node",
          softwareVersion: "0.1.0"
        },
        url: "/api/v1/federation/nodes/node_edge_outbox_01/heartbeat"
      });

      const payload = {
        events: [
          {
            clientEventId: "edge-event-001",
            entityId: "report-edge-1",
            entityType: "communityReport",
            payload: {
              title: "Offline report"
            },
            type: "report.created"
          }
        ],
        nodeId: "node_edge_outbox_01"
      };
      const firstFlush = await app.inject({
        headers: authHeaders,
        method: "POST",
        payload,
        url: "/api/v1/edge/outbox/flush"
      });
      expect(firstFlush.statusCode).toBe(202);
      expect(firstFlush.json()).toMatchObject({
        acceptedCount: 1,
        contractVersion: "cop-edge-outbox-flush-v1",
        duplicateCount: 0,
        items: [
          expect.objectContaining({
            clientEventId: "edge-event-001",
            replayOffset: 1,
            status: "accepted"
          })
        ],
        rejectedCount: 0
      });

      const secondFlush = await app.inject({
        headers: authHeaders,
        method: "POST",
        payload,
        url: "/api/v1/edge/outbox/flush"
      });
      expect(secondFlush.statusCode).toBe(202);
      expect(secondFlush.json()).toMatchObject({
        acceptedCount: 0,
        duplicateCount: 1,
        items: [
          expect.objectContaining({
            clientEventId: "edge-event-001",
            replayOffset: 1,
            status: "duplicate"
          })
        ],
        rejectedCount: 0
      });

      const replayResponse = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: "/api/v1/events/domain?fromOffset=0&limit=10&type=report.created"
      });
      expect(replayResponse.json()).toMatchObject({
        summary: {
          count: 1,
          totalAvailable: 1
        }
      });
    } finally {
      await app.close();
    }
  });

  it("persists edge replay cursor acknowledgements monotonically", async () => {
    const app = buildServer({ now: () => new Date("2026-06-19T12:00:00Z") });
    try {
      await app.inject({
        headers: authHeaders,
        method: "POST",
        payload: {
          capabilities: ["offline-outbox", "domain-events"],
          classificationMax: "INTERNAL",
          health: "ok",
          nodeName: "offline edge cursor",
          nodeRole: "edge-node",
          softwareVersion: "0.1.0"
        },
        url: "/api/v1/federation/nodes/node_edge_cursor_01/heartbeat"
      });

      const firstAck = await app.inject({
        headers: authHeaders,
        method: "POST",
        payload: { lastAckedOffset: 3 },
        url: "/api/v1/edge/replay-cursors/node_edge_cursor_01/ack"
      });
      expect(firstAck.statusCode).toBe(200);
      expect(firstAck.json()).toMatchObject({
        contractVersion: "cop-edge-replay-cursor-v1",
        cursor: {
          ackedAt: "2026-06-19T12:00:00.000Z",
          lastAckedOffset: 3,
          nodeId: "node_edge_cursor_01",
          updatedBy: "lab"
        }
      });

      const staleAck = await app.inject({
        headers: authHeaders,
        method: "POST",
        payload: { lastAckedOffset: 2 },
        url: "/api/v1/edge/replay-cursors/node_edge_cursor_01/ack"
      });
      expect(staleAck.statusCode).toBe(200);
      expect(staleAck.json()).toMatchObject({
        cursor: {
          lastAckedOffset: 3,
          nodeId: "node_edge_cursor_01"
        }
      });

      const cursor = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: "/api/v1/edge/replay-cursors/node_edge_cursor_01"
      });
      expect(cursor.statusCode).toBe(200);
      expect(cursor.json()).toMatchObject({
        cursor: {
          lastAckedOffset: 3,
          nodeId: "node_edge_cursor_01"
        }
      });
    } finally {
      await app.close();
    }
  });

  it("allows operators to inspect, redrive and resolve dead-letter events", async () => {
    const app = buildServer({ now: () => new Date("2026-06-19T12:00:00Z") });
    try {
      const rejected = await app.inject({
        headers: {
          ...authHeaders,
          "x-correlation-id": "corr-dlq-operator"
        },
        method: "POST",
        payload: {
          entityId: "incident-dlq-1",
          entityType: "incident",
          payload: {
            title: "Rejected incident"
          },
          producerNodeId: "node_missing",
          type: "incident.created"
        },
        url: "/api/v1/events/domain"
      });
      expect(rejected.statusCode).toBe(422);

      const list = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: "/api/v1/events/dead-letter"
      });
      expect(list.statusCode).toBe(200);
      const deadLetterId = list.json().items[0].deadLetterId as string;

      const detail = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: `/api/v1/events/dead-letter/${deadLetterId}`
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        contractVersion: "cop-domain-event-dlq-detail-v1",
        deadLetter: {
          correlationId: "corr-dlq-operator",
          deadLetterId,
          errorCode: "UNKNOWN_PRODUCER_NODE",
          retryCount: 0,
          status: "open"
        }
      });

      const redrive = await app.inject({
        headers: authHeaders,
        method: "POST",
        payload: {
          event: {
            entityId: "incident-dlq-1",
            entityType: "incident",
            eventId: "event-redrive-001",
            payload: {
              title: "Recovered incident"
            },
            producerNodeId: "node_central_cop",
            type: "incident.created"
          }
        },
        url: `/api/v1/events/dead-letter/${deadLetterId}/redrive`
      });
      expect(redrive.statusCode).toBe(202);
      expect(redrive.json()).toMatchObject({
        contractVersion: "cop-domain-event-dlq-redrive-v1",
        deadLetter: {
          deadLetterId,
          resolvedBy: "lab",
          retryCount: 1,
          retryLastEventId: "event-redrive-001",
          status: "redriven"
        },
        event: {
          id: "event-redrive-001",
          replayOffset: 1,
          type: "incident.created"
        },
        status: "redriven"
      });

      const resolve = await app.inject({
        headers: authHeaders,
        method: "POST",
        url: `/api/v1/events/dead-letter/${deadLetterId}/resolve`
      });
      expect(resolve.statusCode).toBe(200);
      expect(resolve.json()).toMatchObject({
        contractVersion: "cop-domain-event-dlq-resolve-v1",
        deadLetter: {
          deadLetterId,
          status: "resolved"
        }
      });
    } finally {
      await app.close();
    }
  });
});
