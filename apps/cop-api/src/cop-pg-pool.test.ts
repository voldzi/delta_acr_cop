import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { MockPool } = vi.hoisted(() => ({ MockPool: vi.fn() }));
vi.mock("pg", () => ({ default: { Pool: MockPool } }));
import { createCopPgPool, readCopPgPoolDiagnostics, setCopPgPoolErrorSink } from "./cop-pg-pool.js";
import { PostgresVoiceCallStore } from "./voice-call-store.js";
import { PostgresWebSessionStore } from "./web-session-store.js";
import { PostgresDriverMeasurementConsentStore } from "./driver-measurement-consent-store.js";
import { OpenAiMcpAssistant } from "./openai-mcp-assistant.js";

class FakePool extends EventEmitter {
  totalCount: number | undefined = 2;
  idleCount = 1;
  waitingCount = 0;
  ended = false;
  ending = false;
  options = { max: 5 };
  query = vi.fn(async () => {
    throw new Error("synthetic query failure");
  });
}

const pools: FakePool[] = [];
function fixture() {
  const pool = new FakePool();
  pools.push(pool);
  MockPool.mockImplementationOnce(function () {
    return pool;
  });
  return pool;
}

afterEach(() => {
  pools.forEach((pool) => {
    pool.ended = true;
  });
  readCopPgPoolDiagnostics();
  setCopPgPoolErrorSink();
  vi.clearAllMocks();
});

describe("owned COP PostgreSQL pool diagnostics", () => {
  it("labels default application names without changing limits, SSL or query rejection", async () => {
    const pool = fixture();
    const config = {
      connectionString: "postgres://synthetic:private@example.test/db",
      max: 2,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: true }
    };
    const wrapped = createCopPgPool("web-session", config);
    expect(MockPool).toHaveBeenCalledWith({
      ...config,
      application_name: "cop-api:web-session",
      fallback_application_name: "cop-api:web-session"
    });
    expect(wrapped).toBe(pool);
    await expect(wrapped.query("synthetic statement")).rejects.toThrow("synthetic query failure");
  });

  it("retains an explicitly configured service name", () => {
    fixture();
    createCopPgPool("dispatch-lease", { application_name: "cop-private-dispatch-lease", max: 1 });
    expect(MockPool.mock.calls[0]?.[0]).toMatchObject({ application_name: "cop-private-dispatch-lease", max: 1 });
  });

  it("preserves pg DSN parameter precedence and supplies attribution when the DSN has no name", async () => {
    const actual = await vi.importActual<typeof import("pg")>("pg");
    const parameters = (config: Record<string, unknown>) => {
      const client = new actual.default.Client(config);
      return (
        client as unknown as { connectionParameters: { application_name: string; fallback_application_name: string } }
      ).connectionParameters;
    };
    fixture();
    createCopPgPool("web-session", {
      connectionString: "postgres://synthetic:private@example.test/db?application_name=explicit-dsn"
    });
    expect(parameters(MockPool.mock.calls[0]?.[0]).application_name).toBe("explicit-dsn");
    fixture();
    createCopPgPool("voice-call", { connectionString: "postgres://synthetic:private@example.test/db" });
    expect(parameters(MockPool.mock.calls[1]?.[0]).application_name).toBe("cop-api:voice-call");
    expect(parameters(MockPool.mock.calls[1]?.[0]).fallback_application_name).toBe("cop-api:voice-call");
  });

  it("handles an idle-client error without throwing or retaining private details", () => {
    const pool = fixture();
    const sink = vi.fn();
    setCopPgPoolErrorSink(sink);
    createCopPgPool("voice-call", {});
    const error = Object.assign(new Error("private SQL and account contents"), {
      code: "53300",
      detail: "private token"
    });
    expect(() => pool.emit("error", error)).not.toThrow();
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "voice-call",
        reasonCode: "53300",
        errorCount: 1,
        total: 2,
        idle: 1,
        waiting: 0
      })
    );
    const text = JSON.stringify([readCopPgPoolDiagnostics(), sink.mock.calls]);
    expect(text).not.toMatch(/private SQL|account contents|private token|postgres:\/\//);
    setCopPgPoolErrorSink(() => {
      throw new Error("synthetic diagnostic failure");
    });
    expect(() => pool.emit("error", Object.assign(new Error("anything"), { code: "private-code" }))).not.toThrow();
    expect(JSON.stringify(readCopPgPoolDiagnostics())).toContain("PG_DATABASE_ERROR");
  });

  it("reads counters without queries and treats unavailable counters as unknown", () => {
    const pool = fixture();
    pool.totalCount = undefined;
    createCopPgPool("track-history", {});
    expect(readCopPgPoolDiagnostics()).toMatchObject({
      poolCount: 1,
      pools: [{ component: "track-history", total: null, idle: 1, waiting: 0, configuredMax: 5 }]
    });
    expect(pool.query).not.toHaveBeenCalled();
    pool.ending = true;
    expect(readCopPgPoolDiagnostics()).toMatchObject({ poolCount: 0, pools: [] });
  });

  it("handles idle errors in all four previously unguarded production constructors", () => {
    const voice = fixture();
    new PostgresVoiceCallStore({});
    const sessions = fixture();
    new PostgresWebSessionStore({ encryptionSecret: "synthetic-test-only" });
    const consent = fixture();
    new PostgresDriverMeasurementConsentStore("postgres://synthetic@example.test/db");
    const assistant = fixture();
    new OpenAiMcpAssistant({
      enabled: false,
      apiKey: "",
      connectionString: "postgres://synthetic@example.test/db",
      dailyUsdMicros: 1,
      monthlyUsdMicros: 1,
      dailyTokenLimit: 1000,
      monthlyTokenLimit: 1000,
      userDailyRequests: 1
    });
    for (const pool of [voice, sessions, consent, assistant]) {
      expect(() =>
        pool.emit("error", Object.assign(new Error("synthetic idle failure"), { code: "ECONNRESET" }))
      ).not.toThrow();
      expect(pool.query).not.toHaveBeenCalled();
    }
    expect(readCopPgPoolDiagnostics()).toMatchObject({
      poolCount: 4,
      pools: [
        expect.objectContaining({ component: "voice-call", errorCount: 1 }),
        expect.objectContaining({ component: "web-session", errorCount: 1 }),
        expect.objectContaining({ component: "driver-consent", errorCount: 1 }),
        expect.objectContaining({ component: "openai-mcp", errorCount: 1 })
      ]
    });
  });
});
