import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { ContentErasureStoreError } from "./content-erasure.js";
import { FlightDataSourceAdapter, type FlightDataSource } from "./flight-data-source.js";

const apps: ReturnType<typeof buildServer>[] = [];
beforeEach(() => {
  for (const [key, value] of Object.entries({ NODE_ENV: "test", COP_AUTH_MODE: "lab", COP_ALLOW_LAB_TOKEN: "true",
    COP_DATABASE_URL: "", COP_STREAM_BUS_DATABASE_URL: "", COP_ACCOUNT_ERASURE_ENABLED: "false", COP_ACCOUNT_SAFETY_GUARD_REQUIRED: "false",
    COP_JIZDA_APP_LINK_ENABLED: "false", COP_WEB_BFF_SESSION_ENABLED: "false", COP_FLIGHT_DATA_ENABLED: "false",
    COP_SITUATION_DATA_ENABLED: "false", COP_SAFETY_DATA_ENABLED: "false", COP_TAK_GATEWAY_ENABLED: "false", COP_SIM_SEARCH_DATA_ENABLED: "false",
    COP_CSM_MESSAGING_ENABLED: "false", COP_AI_CONTEXT_INDEX_ENABLED: "true", COP_AI_SEMANTIC_RETRIEVAL_ENABLED: "false",
    COP_AI_CONTEXT_INDEX_REFRESH_SECONDS: "120", COP_SAFETY_NOTIFICATIONS_ENABLED: "false", COP_AI_CHAT_ROUTER_ENABLED: "false" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External access forbidden in synthetic startup test"); }));
});
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function fixture() {
  let resolve!: (result: never) => void, reject!: (error: unknown) => void;
  const pending = new Promise<never>((ok, fail) => { resolve = ok; reject = fail; });
  const config = { enabled: true, baseUrl: "https://flight.synthetic.invalid", timeoutMs: 1000,
    airportCacheTtlMs: 1000, includeStale: false, limit: 10, pollMs: 100 };
  const poll = vi.fn(() => pending);
  const source = { config, sourceSystem: new FlightDataSourceAdapter(config).sourceSystem, poll } as FlightDataSource;
  const app = buildServer({ flightDataSource: source }); apps.push(app);
  return { app, poll, resolve, reject };
}
describe("guarded optional flight startup", () => {
  it("binds the live API while the first poll is pending and does not overlap interval polls", async () => {
    const f = fixture(); await f.app.ready();
    expect((await f.app.inject({url: "/health/live"})).statusCode).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(f.poll).toHaveBeenCalledTimes(1);
    f.reject(new ContentErasureStoreError(503, "CONTENT_PROJECTION_UNAVAILABLE"));
    await new Promise(setImmediate);
    expect((await f.app.inject({url: "/health/live"})).statusCode).toBe(200);
    const dependency=(await f.app.inject({url: "/health/dependencies"})).json().dependencies.find((v:{name:string})=>v.name==="flight-data-source");
    expect(dependency.status).toBe("degraded");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not hydrate a late feed response after close begins", async () => {
    const f = fixture(); await f.app.ready();
    const closing=f.app.close(); await new Promise(setImmediate);
    f.reject(new Error("late synthetic provider failure")); await closing;
    apps.splice(apps.indexOf(f.app),1);
    expect(f.poll).toHaveBeenCalledTimes(1);
  });
});
