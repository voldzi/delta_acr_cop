import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopStreamBroadcaster, type CopStreamMessage } from "./cop-stream.js";
import { createCopStreamBusFromEnv, MemoryCopStreamBus, PostgresCopStreamBus } from "./cop-stream-bus.js";
import type { ObservedObject } from "@cop/canonical-model";

type FakeConnection = {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => boolean;
  config: Record<string, unknown>;
};

const pgState = vi.hoisted(() => ({
  pools: [] as FakeConnection[],
  clients: [] as FakeConnection[],
  onClientCreated: undefined as ((client: FakeConnection) => void) | undefined
}));

vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  class FakePool extends EventEmitter {
    ended = false;
    ending = false;
    options: Record<string, unknown>;
    connect = vi.fn(async () => undefined);
    query = vi.fn(async () => ({ rows: [] }));
    end = vi.fn(async () => {
      this.ending = true;
      this.ended = true;
    });
    constructor(readonly config: Record<string, unknown>) {
      super();
      this.options = { ...config, max: config.max ?? 10 };
      pgState.pools.push(this);
    }
  }
  class FakeClient extends EventEmitter {
    connect = vi.fn(async () => undefined);
    query = vi.fn(async () => ({ rows: [] }));
    end = vi.fn(async () => {
      this.emit("end");
    });
    constructor(readonly config: Record<string, unknown>) {
      super();
      pgState.clients.push(this);
      pgState.onClientCreated?.(this);
    }
  }
  return { default: { Pool: FakePool, Client: FakeClient } };
});

describe("COP stream bus", () => {
  it("delivers memory bus messages to local subscribers", async () => {
    const broadcaster = new CopStreamBroadcaster();
    const message = broadcaster.createObjectUpserts([object("AIR_SIM_UAV-0100")], new Date("2026-05-19T08:03:00Z"));
    const bus = new MemoryCopStreamBus();
    const delivered: CopStreamMessage[] = [];
    const unsubscribe = bus.subscribe((received) => delivered.push(received));

    await bus.init();
    await bus.publish(message!);
    unsubscribe();
    await bus.close();

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      sequence: 1,
      type: "delta"
    });
    expect(bus.metrics).toMatchObject({
      localDeliveriesTotal: 1,
      mode: "memory",
      publishedMessagesTotal: 1,
      ready: true,
      receivedMessagesTotal: 0
    });
  });

  it("uses memory bus by default", () => {
    expect(createCopStreamBusFromEnv({}).name).toBe("memory");
  });

  it("rejects explicit postgres mode without a database URL", () => {
    expect(() => createCopStreamBusFromEnv({ COP_STREAM_BUS: "postgres" })).toThrow(/missing database URL/u);
  });
});

describe("PostgreSQL COP stream lifecycle", () => {
  beforeEach(() => {
    pgState.pools.length = 0;
    pgState.clients.length = 0;
    pgState.onClientCreated = undefined;
  });

  it("closes a connected provisional listener when LISTEN fails and exposes only a reason code", async () => {
    pgState.onClientCreated = (client) =>
      client.query.mockRejectedValueOnce(new Error("private SQL and connection details"));
    const bus = new PostgresCopStreamBus({});
    await expect(bus.init()).rejects.toThrow("STREAM_LISTENER_UNAVAILABLE");
    expect(pgState.clients[0]!.connect).toHaveBeenCalledOnce();
    expect(pgState.clients[0]!.end).toHaveBeenCalledOnce();
    expect(bus.metrics).toMatchObject({ ready: false, lastError: "STREAM_LISTENER_UNAVAILABLE" });
    expect(bus.diagnostics()).not.toContain("private SQL");
    await bus.close();
    expect(pgState.clients[0]!.end).toHaveBeenCalledOnce();
    expect(pgState.pools[0]!.end).toHaveBeenCalledOnce();
    expect(bus.diagnosticCounters()).toEqual({
      ownedListenerCount: 0,
      listenerConnected: false,
      poolHealthy: false,
      closed: true
    });
  });

  it("cleans up a failed connection attempt", async () => {
    pgState.onClientCreated = (client) => client.connect.mockRejectedValueOnce(new Error("private connection details"));
    const bus = new PostgresCopStreamBus({});
    await expect(bus.init()).rejects.toThrow("STREAM_LISTENER_UNAVAILABLE");
    expect(pgState.clients[0]!.query).not.toHaveBeenCalled();
    expect(pgState.clients[0]!.end).toHaveBeenCalledOnce();
    await bus.close();
  });

  it("does not open a replacement when closure of its existing listener cannot be confirmed", async () => {
    const bus = new PostgresCopStreamBus({});
    await bus.init();
    pgState.clients[0]!.emit("error", new Error("synthetic listener failure"));
    pgState.clients[0]!.end.mockRejectedValueOnce(new Error("private close details"));
    await expect(bus.init()).rejects.toThrow("STREAM_LISTENER_CLOSE_UNAVAILABLE");
    await expect(bus.init()).rejects.toThrow("STREAM_LISTENER_CLOSE_UNAVAILABLE");
    expect(pgState.clients).toHaveLength(1);
    expect(bus.diagnosticCounters().ownedListenerCount).toBe(1);
    expect(bus.metrics.ready).toBe(false);
    expect(bus.diagnostics()).not.toContain("private close");
    await bus.close();
  });

  it("does not declare a listener ready if it emits an error while LISTEN is pending", async () => {
    const gate = deferred();
    const listenStarted = deferred();
    pgState.onClientCreated = (client) =>
      client.query.mockImplementationOnce(() => {
        listenStarted.resolve();
        return gate.promise;
      });
    const bus = new PostgresCopStreamBus({});
    const initializing = bus.init();
    const failedInit = expect(initializing).rejects.toThrow("STREAM_LISTENER_UNAVAILABLE");
    await listenStarted.promise;
    pgState.clients[0]!.emit("error", new Error("private connection details"));
    gate.resolve();
    await failedInit;
    expect(bus.metrics.ready).toBe(false);
    expect(pgState.clients[0]!.end).toHaveBeenCalledOnce();
    await bus.close();
  });

  it("keeps readiness false when publication succeeds before listener initialization", async () => {
    const bus = new PostgresCopStreamBus({});
    await bus.publish(message());
    expect(bus.metrics.ready).toBe(false);
    expect(pgState.clients).toHaveLength(0);
    await bus.close();
  });

  it("retains local delivery and safe diagnostics when publication fails", async () => {
    const bus = new PostgresCopStreamBus({});
    const delivered: CopStreamMessage[] = [];
    bus.subscribe((message) => delivered.push(message));
    await bus.init();
    pgState.pools[0]!.query.mockRejectedValueOnce(new Error("private SQL details"));
    await bus.publish(message());
    expect(delivered).toHaveLength(1);
    expect(bus.metrics).toMatchObject({ ready: false, lastError: "STREAM_PUBLISH_UNAVAILABLE" });
    expect(bus.diagnostics()).not.toContain("private SQL");
    await bus.publish(message());
    expect(bus.metrics.ready).toBe(true);
    await bus.close();
  });

  it("does not make a failed listener ready after a successful local publication", async () => {
    const bus = new PostgresCopStreamBus({});
    const delivered: CopStreamMessage[] = [];
    bus.subscribe((message) => delivered.push(message));
    await bus.init();
    pgState.clients[0]!.emit("error", new Error("private database details"));
    await bus.publish(message());
    expect(delivered).toHaveLength(1);
    expect(bus.metrics).toMatchObject({
      ready: false,
      publishedMessagesTotal: 1,
      lastError: "STREAM_LISTENER_UNAVAILABLE"
    });
    expect(bus.diagnostics()).not.toContain("private database details");
    await bus.close();
  });

  it("treats a listener end as unavailable and explicitly reinitializes one listener", async () => {
    const bus = new PostgresCopStreamBus({});
    await bus.init();
    pgState.clients[0]!.emit("end");
    await bus.publish(message());
    expect(bus.metrics.ready).toBe(false);
    await bus.init();
    expect(pgState.clients).toHaveLength(2);
    expect(pgState.clients[0]!.end).toHaveBeenCalledOnce();
    expect(bus.metrics.ready).toBe(true);
    await bus.close();
    expect(pgState.clients[1]!.end).toHaveBeenCalledOnce();
  });

  it("shares concurrent initialization and avoids duplicate listeners on repeated initialization", async () => {
    const gate = deferred();
    const bus = new PostgresCopStreamBus({});
    pgState.pools[0]!.query.mockReturnValueOnce(gate.promise);
    const first = bus.init();
    const second = bus.init();
    expect(pgState.pools[0]!.query).toHaveBeenCalledOnce();
    gate.resolve();
    await Promise.all([first, second]);
    await bus.init();
    expect(pgState.clients).toHaveLength(1);
    expect(pgState.clients[0]!.query).toHaveBeenCalledOnce();
    expect(bus.metrics.ready).toBe(true);
    await bus.close();
  });

  it("actively cancels an unfinished LISTEN on shutdown without closing the client twice", async () => {
    const listenStarted = deferred();
    pgState.onClientCreated = (client) => {
      client.query.mockImplementationOnce(() => {
        listenStarted.resolve();
        return new Promise((_resolve, reject) => {
          client.end.mockImplementationOnce(async () => {
            client.emit("end");
            reject(new Error("LISTEN cancelled by session close"));
          });
        });
      });
    };
    const bus = new PostgresCopStreamBus({});
    const initializing = bus.init();
    const failedInit = expect(initializing).rejects.toThrow("STREAM_BUS_CLOSED");
    await listenStarted.promise;
    const closing = bus.close();
    await Promise.all([failedInit, closing, bus.close()]);
    expect(bus.metrics.ready).toBe(false);
    expect(pgState.clients[0]!.end).toHaveBeenCalledOnce();
    expect(pgState.pools[0]!.end).toHaveBeenCalledOnce();
    await expect(bus.init()).rejects.toThrow("STREAM_BUS_CLOSED");
    expect(pgState.clients).toHaveLength(1);
  });

  it("cancels shutdown during connect even when ending the client never settles its connect promise", async () => {
    const connectStarted = deferred();
    pgState.onClientCreated = (client) =>
      client.connect.mockImplementationOnce(() => {
        connectStarted.resolve();
        return new Promise(() => undefined);
      });
    const bus = new PostgresCopStreamBus({});
    const initializing = bus.init();
    const failedInit = expect(initializing).rejects.toThrow("STREAM_BUS_CLOSED");
    await connectStarted.promise;
    await Promise.all([failedInit, bus.close(), bus.close()]);
    expect(pgState.clients[0]!.end).toHaveBeenCalledOnce();
    expect(pgState.clients[0]!.query).not.toHaveBeenCalled();
    expect(pgState.pools[0]!.end).toHaveBeenCalledOnce();
    expect(bus.metrics.ready).toBe(false);
    expect(bus.diagnosticCounters().ownedListenerCount).toBe(0);
  });

  it("tags a dedicated listener without changing explicit names or connection settings", async () => {
    const first = new PostgresCopStreamBus({ connectionTimeoutMillis: 1250, max: 2 });
    await first.init();
    expect(pgState.clients[0]!.config).toMatchObject({
      application_name: "cop-api:stream-listener",
      fallback_application_name: "cop-api:stream-listener",
      connectionTimeoutMillis: 1250,
      max: 2
    });
    expect(first.diagnosticCounters()).toEqual({
      ownedListenerCount: 1,
      listenerConnected: true,
      poolHealthy: true,
      closed: false
    });
    await first.close();
    const named = new PostgresCopStreamBus({
      application_name: "explicit-listener",
      fallback_application_name: "explicit-fallback"
    });
    await named.init();
    expect(pgState.clients[1]!.config).toMatchObject({
      application_name: "explicit-listener",
      fallback_application_name: "explicit-fallback"
    });
    await named.close();
  });

  it("does not create a listener after schema failure or a shutdown during schema creation", async () => {
    const failed = new PostgresCopStreamBus({});
    pgState.pools[0]!.query.mockRejectedValueOnce(new Error("private schema details"));
    await expect(failed.init()).rejects.toThrow("STREAM_SCHEMA_UNAVAILABLE");
    expect(pgState.clients).toHaveLength(0);
    await failed.close();
    const gate = deferred();
    const stopped = new PostgresCopStreamBus({});
    pgState.pools[1]!.query.mockReturnValueOnce(gate.promise);
    const initializing = stopped.init();
    const failedInit = expect(initializing).rejects.toThrow("STREAM_BUS_CLOSED");
    const closing = stopped.close();
    gate.resolve();
    await Promise.all([failedInit, closing]);
    expect(pgState.clients).toHaveLength(0);
    expect(pgState.pools[1]!.end).toHaveBeenCalledOnce();
  });

  it("recovers a pool fault on successful publication only while its listener is still available", async () => {
    const bus = new PostgresCopStreamBus({});
    await bus.init();
    pgState.pools[0]!.emit("error", new Error("private pool details"));
    expect(bus.metrics).toMatchObject({ ready: false, lastError: "STREAM_POOL_UNAVAILABLE" });
    await bus.publish(message());
    expect(bus.metrics.ready).toBe(true);
    expect(bus.metrics.lastError).toBeUndefined();
    pgState.clients[0]!.emit("end");
    await bus.publish(message());
    expect(bus.metrics.ready).toBe(false);
    await bus.close();
  });
});

function deferred(): { promise: Promise<unknown>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<unknown>((done) => {
    resolve = () => done({ rows: [] });
  });
  return { promise, resolve };
}

function message(): CopStreamMessage {
  const broadcaster = new CopStreamBroadcaster();
  return broadcaster.createObjectUpserts([object("AIR_SIM_UAV-0100")], new Date("2026-05-19T08:03:00Z"))!;
}

function object(objectId: string): ObservedObject {
  return {
    affiliation: "HOSTILE",
    confidence: 0.9,
    domain: "AIR",
    lastUpdatedAt: "2026-05-19T08:00:00Z",
    objectId,
    objectType: "UAV",
    position: {
      lat: 50.08,
      lon: 14.42
    },
    status: "ACTIVE",
    synthetic: true
  };
}
