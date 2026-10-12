import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialEdgeStatus, EdgeRuntime, readEdgeConfig } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
      centralAuthMode: "static",
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

  it("reads explicit service OIDC configuration without changing the default static mode", () => {
    expect(readEdgeConfig({}).centralAuthMode).toBe("static");
    expect(readEdgeConfig({
      COP_EDGE_CENTRAL_AUTH_MODE: "oidc",
      COP_EDGE_CENTRAL_OIDC_ISSUER: "https://identity.example.test/realms/cop",
      COP_EDGE_CENTRAL_OIDC_CLIENT_ID: "synthetic-edge-client",
      COP_EDGE_CENTRAL_OIDC_CLIENT_SECRET: "synthetic-edge-secret"
    })).toMatchObject({
      centralAuthMode: "oidc",
      centralOidcIssuer: "https://identity.example.test/realms/cop",
      centralOidcClientId: "synthetic-edge-client",
      centralOidcClientSecret: "synthetic-edge-secret"
    });
  });

  it.each(["hybrid", "", "unknown"])("rejects an unknown central authentication mode: %s", (mode) => {
    expect(() => readEdgeConfig({ COP_EDGE_CENTRAL_AUTH_MODE: mode }))
      .toThrow("COP_EDGE_CENTRAL_AUTH_MODE must be static or oidc.");
  });

  it("bounds configured upstream time and response size while preserving safe defaults", () => {
    expect(readEdgeConfig({})).toMatchObject({ centralTimeoutMs: 10_000, centralMaxResponseBytes: 16 * 1024 * 1024 });
    expect(readEdgeConfig({ COP_EDGE_CENTRAL_TIMEOUT_MS: "1500", COP_EDGE_CENTRAL_MAX_RESPONSE_BYTES: "1024" }))
      .toMatchObject({ centralTimeoutMs: 1500, centralMaxResponseBytes: 1024 });
    for (const size of ["1023", String(128 * 1024 * 1024 + 1)]) {
      expect(readEdgeConfig({ COP_EDGE_CENTRAL_MAX_RESPONSE_BYTES: size }).centralMaxResponseBytes).toBe(16 * 1024 * 1024);
    }
  });

  it("preserves the static central credential for an existing runtime configuration", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "cop-edge-static-auth-"));
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(init);
      return Response.json({ items: [] });
    }));
    try {
      const config = readEdgeConfig({ COP_EDGE_DATA_DIR: dataDir, COP_EDGE_CENTRAL_TOKEN: "synthetic-static-token" });
      delete config.centralAuthMode;
      const runtime = await EdgeRuntime.create(config);
      expect(await runtime.syncOnce()).toMatchObject({ status: "ok", mode: "ONLINE", pulled: 0 });
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(new Headers(request.headers).get("authorization")).toBe("Bearer synthetic-static-token");
      }
      expect(await readFile(join(dataDir, "state.json"), "utf8")).not.toContain("synthetic-static-token");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("renews service OIDC credentials on the same runtime and keeps outbox acknowledgement behavior", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "cop-edge-oidc-renewal-"));
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    let exchanges = 0;
    const centralAuthorizations: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith("https://identity.example.test/")) {
        exchanges += 1;
        return Response.json({ access_token: `synthetic-access-${exchanges}`, token_type: "Bearer", expires_in: 60 });
      }
      centralAuthorizations.push(new Headers(init.headers).get("authorization") ?? "");
      if (url.endsWith("/api/v1/edge/outbox/flush")) {
        const body = JSON.parse(String(init.body)) as { events: Array<{ clientEventId: string }> };
        return Response.json({ items: body.events.map((event) => ({ clientEventId: event.clientEventId, status: "accepted" })) });
      }
      return Response.json({ items: [] });
    }));
    try {
      const runtime = await EdgeRuntime.create(oidcConfig(dataDir));
      await runtime.queueOutboxEvent({ clientEventId: "synthetic-event-first", payload: { title: "Synthetic first event" } });
      expect(await runtime.syncOnce()).toMatchObject({ status: "ok", flushed: { accepted: 1 }, replayOffset: 0 });
      expect(exchanges).toBe(1);
      expect(centralAuthorizations).toEqual(Array(3).fill("Bearer synthetic-access-1"));

      clock += 61_000;
      await runtime.queueOutboxEvent({ clientEventId: "synthetic-event-second", payload: { title: "Synthetic second event" } });
      expect(await runtime.syncOnce()).toMatchObject({ status: "ok", flushed: { accepted: 1 }, replayOffset: 0 });
      expect(exchanges).toBe(2);
      expect(centralAuthorizations.slice(3)).toEqual(Array(3).fill("Bearer synthetic-access-2"));
      expect(runtime.getStatus().outboxItems).toBe(0);
      const persisted = await readFile(join(dataDir, "state.json"), "utf8");
      for (const secret of ["synthetic-edge-secret", "synthetic-static-fallback", "synthetic-access-1", "synthetic-access-2"]) {
        expect(persisted).not.toContain(secret);
        expect(JSON.stringify(runtime.getPublicState())).not.toContain(secret);
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("retains queued events and never falls back to the static token when OIDC is unavailable", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "cop-edge-oidc-outage-"));
    const centralRequests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("https://identity.example.test/")) {
        return Response.json({ error_description: "synthetic-edge-secret synthetic-static-fallback" }, { status: 503 });
      }
      centralRequests.push(url);
      return Response.json({ items: [] });
    }));
    try {
      const runtime = await EdgeRuntime.create(oidcConfig(dataDir));
      await runtime.queueOutboxEvent({ clientEventId: "synthetic-pending-event", payload: { title: "Synthetic pending event" } });
      expect(await runtime.syncOnce()).toMatchObject({ status: "degraded", mode: "OFFLINE", flushed: { accepted: 0, rejected: 0 } });
      expect(centralRequests).toEqual([]);
      expect(runtime.getStatus()).toMatchObject({ outboxItems: 1, lastError: "Central COP authentication is unavailable." });
      const persisted = await readFile(join(dataDir, "state.json"), "utf8");
      expect(persisted).toContain("synthetic-pending-event");
      expect(persisted).not.toContain("synthetic-edge-secret");
      expect(persisted).not.toContain("synthetic-static-fallback");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("invalidates a rejected token without automatically repeating the outbox mutation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "cop-edge-oidc-rejected-"));
    let exchanges = 0;
    let flushes = 0;
    const centralAuthorizations: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith("https://identity.example.test/")) {
        exchanges += 1;
        return Response.json({ access_token: `synthetic-access-${exchanges}`, token_type: "Bearer", expires_in: 60 });
      }
      centralAuthorizations.push(new Headers(init.headers).get("authorization") ?? "");
      if (url.endsWith("/api/v1/edge/outbox/flush")) {
        flushes += 1;
        if (flushes === 1) {
          return Response.json({ error: { message: "Rejected synthetic-access-1 synthetic-edge-secret" } }, { status: 401 });
        }
        return Response.json({ items: [{ clientEventId: "synthetic-retry-event", status: "accepted" }] });
      }
      return Response.json({ items: [] });
    }));
    try {
      const runtime = await EdgeRuntime.create(oidcConfig(dataDir));
      await runtime.queueOutboxEvent({ clientEventId: "synthetic-retry-event", payload: { title: "Synthetic retry event" } });
      expect(await runtime.syncOnce()).toMatchObject({ status: "degraded", mode: "OFFLINE" });
      expect(flushes).toBe(1);
      expect(runtime.getStatus()).toMatchObject({ outboxItems: 1, lastError: "Central COP request failed (HTTP 401)." });
      expect(exchanges).toBe(2); // The existing degraded heartbeat obtains a fresh token.
      expect(centralAuthorizations).toEqual(["Bearer synthetic-access-1", "Bearer synthetic-access-1", "Bearer synthetic-access-2"]);
      expect(await readFile(join(dataDir, "state.json"), "utf8")).not.toContain("synthetic-access-1");

      expect(await runtime.syncOnce()).toMatchObject({ status: "ok", flushed: { accepted: 1 } });
      expect(flushes).toBe(2);
      expect(exchanges).toBe(2);
      expect(runtime.getStatus().outboxItems).toBe(0);
      expect(centralAuthorizations.slice(3)).toEqual(Array(3).fill("Bearer synthetic-access-2"));
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it.each(["headers", "body"])("bounds a stalled upstream %s, cancels it and permits a later manual sync", async (phase) => {
    const dataDir = await mkdtemp(join(tmpdir(), "cop-edge-central-timeout-"));
    const cancelled = vi.fn();
    let finishLate!: (response: Response) => void;
    let stalledSignal: AbortSignal | undefined;
    let first = true;
    let flushes = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const isFlush = url.endsWith("/api/v1/edge/outbox/flush");
      if (isFlush) flushes += 1;
      if (first && isFlush) {
        first = false;
        stalledSignal = init.signal ?? undefined;
        if (phase === "headers") return new Promise<Response>((resolve) => { finishLate = resolve; });
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
          cancel: cancelled
        }));
      }
      return centralSyncResponse(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const runtime = await EdgeRuntime.create({
        ...readEdgeConfig({ COP_EDGE_DATA_DIR: dataDir, COP_EDGE_CENTRAL_TOKEN: "synthetic-static" }),
        centralTimeoutMs: 20
      });
      await runtime.queueOutboxEvent({ clientEventId: "synthetic-timed-out-event", payload: { title: "Synthetic timeout event" } });
      vi.useFakeTimers();
      const attempt = runtime.syncOnce();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(20);
      expect(await attempt).toMatchObject({ status: "degraded", mode: "OFFLINE" });
      expect(stalledSignal?.aborted).toBe(true);
      expect(flushes).toBe(1);
      expect(runtime.getStatus()).toMatchObject({ outboxItems: 1, lastError: "Central COP request timed out." });
      expect(await readFile(join(dataDir, "state.json"), "utf8")).toContain("synthetic-timed-out-event");
      if (phase === "headers") {
        finishLate(new Response(new ReadableStream({ cancel: cancelled })));
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(cancelled).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
      expect(await runtime.syncOnce()).toMatchObject({ status: "ok", flushed: { accepted: 1 } });
      expect(flushes).toBe(2);
      expect(runtime.getStatus()).toMatchObject({ outboxItems: 0, lastError: null });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it.each(["stream", "declared"])("cancels an oversized upstream %s without losing the queued event", async (kind) => {
    const dataDir = await mkdtemp(join(tmpdir(), "cop-edge-central-size-"));
    const cancelled = vi.fn();
    let first = true;
    let flushes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const isFlush = url.endsWith("/api/v1/edge/outbox/flush");
      if (isFlush) flushes += 1;
      if (first && isFlush) {
        first = false;
        return new Response(new ReadableStream({
          start(controller) {
            if (kind === "stream") controller.enqueue(new Uint8Array(1025));
          },
          cancel: cancelled
        }), { headers: kind === "declared" ? { "content-length": "1025" } : {} });
      }
      return centralSyncResponse(url, init);
    }));
    try {
      const runtime = await EdgeRuntime.create(readEdgeConfig({
        COP_EDGE_DATA_DIR: dataDir,
        COP_EDGE_CENTRAL_TOKEN: "synthetic-static",
        COP_EDGE_CENTRAL_MAX_RESPONSE_BYTES: "1024"
      }));
      await runtime.queueOutboxEvent({ clientEventId: "synthetic-oversize-event", payload: { title: "Synthetic oversize event" } });
      expect(await runtime.syncOnce()).toMatchObject({ status: "degraded", mode: "OFFLINE" });
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(flushes).toBe(1);
      expect(runtime.getStatus()).toMatchObject({ outboxItems: 1, lastError: "Central COP response exceeds its size limit." });

      expect(await runtime.syncOnce()).toMatchObject({ status: "ok", flushed: { accepted: 1 } });
      expect(flushes).toBe(2);
      expect(runtime.getStatus()).toMatchObject({ outboxItems: 0, lastError: null });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects an outbox redirect without replaying the POST or discarding the pending event", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "cop-edge-central-redirect-"));
    let flushes = 0;
    let replayedPosts = 0;
    const redirects: Array<RequestRedirect | undefined> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/api/v1/edge/outbox/flush")) {
        flushes += 1;
        redirects.push(init.redirect);
        if (init.redirect === "error") throw new TypeError("Synthetic redirect includes synthetic-static");
        // Model the automatic 307/308 POST replay that the default fetch mode would permit.
        replayedPosts += 1;
      }
      return centralSyncResponse(url, init);
    }));
    try {
      const runtime = await EdgeRuntime.create(readEdgeConfig({
        COP_EDGE_DATA_DIR: dataDir, COP_EDGE_CENTRAL_TOKEN: "synthetic-static"
      }));
      await runtime.queueOutboxEvent({ clientEventId: "synthetic-redirect-event", payload: { title: "Synthetic redirect event" } });
      expect(await runtime.syncOnce()).toMatchObject({ status: "degraded", mode: "OFFLINE" });
      expect(flushes).toBe(1);
      expect(replayedPosts).toBe(0);
      expect(redirects).toEqual(["error"]);
      expect(runtime.getStatus()).toMatchObject({ outboxItems: 1, lastError: "Central COP request is unavailable." });
      expect(await readFile(join(dataDir, "state.json"), "utf8")).not.toContain("synthetic-static");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

function centralSyncResponse(url: string, init: RequestInit): Response {
  if (url.endsWith("/api/v1/edge/outbox/flush")) {
    const body = JSON.parse(String(init.body)) as { events: Array<{ clientEventId: string }> };
    return Response.json({ items: body.events.map((event) => ({ clientEventId: event.clientEventId, status: "accepted" })) });
  }
  return Response.json({ items: [] });
}

function oidcConfig(dataDir: string) {
  return readEdgeConfig({
    COP_EDGE_DATA_DIR: dataDir,
    COP_EDGE_CENTRAL_API_URL: "https://cop.example.test",
    COP_EDGE_CENTRAL_TOKEN: "synthetic-static-fallback",
    COP_EDGE_CENTRAL_AUTH_MODE: "oidc",
    COP_EDGE_CENTRAL_OIDC_ISSUER: "https://identity.example.test/realms/cop",
    COP_EDGE_CENTRAL_OIDC_CLIENT_ID: "synthetic-edge-client",
    COP_EDGE_CENTRAL_OIDC_CLIENT_SECRET: "synthetic-edge-secret"
  });
}
