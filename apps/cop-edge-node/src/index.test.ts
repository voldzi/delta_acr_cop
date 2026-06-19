import { describe, expect, it } from "vitest";

import { createInitialEdgeStatus, readEdgeConfig } from "./index.js";

describe("cop-edge-node runtime", () => {
  it("reads edge runtime configuration from environment values", () => {
    const config = readEdgeConfig({
      COP_EDGE_PORT: "4999",
      COP_EDGE_HOST: "127.0.0.1",
      COP_EDGE_NODE_ID: "node_test_edge",
      COP_EDGE_NODE_NAME: "Test Edge",
      COP_EDGE_CLASSIFICATION_MAX: "SENSITIVE",
      COP_EDGE_CENTRAL_API_URL: "http://cop-api:4310",
      COP_EDGE_CENTRAL_TOKEN: "central-token",
      COP_EDGE_ADMIN_TOKEN: "admin-token",
      COP_EDGE_AUTO_SYNC: "false",
      COP_EDGE_SYNC_INTERVAL_MS: "2500",
      COP_EDGE_DATA_DIR: "/tmp/cop-edge-test"
    });

    expect(config).toMatchObject({
      port: 4999,
      host: "127.0.0.1",
      nodeId: "node_test_edge",
      nodeName: "Test Edge",
      classificationMax: "SENSITIVE",
      centralApiUrl: "http://cop-api:4310",
      centralToken: "central-token",
      adminToken: "admin-token",
      autoSync: false,
      syncIntervalMs: 2500,
      dataDir: "/tmp/cop-edge-test"
    });
  });

  it("creates a degraded initial state until central sync succeeds", () => {
    const state = createInitialEdgeStatus();

    expect(state.mode).toBe("DEGRADED");
    expect(state.cachedSnapshotObjects).toBe(0);
    expect(state.outboxItems).toBe(0);
    expect(state.replayOffset).toBe(0);
    expect(state.lastError).toBeNull();
    expect(state.lastSyncAt).toBeNull();
  });
});
