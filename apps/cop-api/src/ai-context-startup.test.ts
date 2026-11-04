import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { ProviderCopiesUnavailableError } from "./provider-copies-erasure.js";
import { SimSearchDataSourceAdapter, type SimSearchDataSource, type SimSearchEntitiesResponse } from "./sim-search-data-source.js";

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
  let reject!: (error: unknown) => void;
  const pending = new Promise<SimSearchEntitiesResponse>((_resolve, fail) => { reject = fail; });
  const response: SimSearchEntitiesResponse = { contractVersion: "sim-search-source-v1", providerId: "sim.search-data", generatedAt: new Date().toISOString(),
    query: {}, results: [], summary: { resultCount: 0, staleResultCount: 0, warningCount: 0 }, warnings: [] };
  const config = { enabled: true, baseUrl: "https://startup.synthetic.invalid", indexLimit: 50, maxLimit: 25, timeoutMs: 1000 };
  const fetchEntities = vi.fn(async () => response).mockImplementationOnce(() => pending);
  const source = { config, sourceSystem: new SimSearchDataSourceAdapter(config).sourceSystem, fetchEntities } as unknown as SimSearchDataSource;
  const app = buildServer({ simSearchDataSource: source }); apps.push(app);
  return { app, fetchEntities, reject };
}
async function indexDependency(app: ReturnType<typeof buildServer>) {
  const response = await app.inject({ url: "/health/dependencies" });
  expect(response.json().dependencies, response.body).toBeDefined();
  return response.json().dependencies.find((value: { name: string }) => value.name === "ai-context-index");
}
describe("guarded optional AI warmup", () => {
  it("starts the API while a provider read is pending and never marks its empty index ready", async () => {
    const f = fixture(); await f.app.ready();
    expect(f.fetchEntities).toHaveBeenCalledTimes(1);
    expect((await f.app.inject({ url: "/health/live" })).statusCode).toBe(200);
    expect(await indexDependency(f.app)).toMatchObject({ status: "degraded", detail: expect.stringContaining("not refreshed") });
    f.reject(new ProviderCopiesUnavailableError()); await new Promise(setImmediate);
    expect(await indexDependency(f.app)).toMatchObject({ status: "degraded", detail: expect.stringContaining("documents 0") });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retries a refused warmup once with the same guarded reader and publishes only a successful refresh", async () => {
    const f = fixture(); await f.app.ready(); f.reject(new ProviderCopiesUnavailableError());
    await vi.waitFor(() => expect(f.fetchEntities).toHaveBeenCalledTimes(2), { timeout: 7_000, interval: 25 });
    await vi.waitFor(async () => expect(await indexDependency(f.app)).toMatchObject({ status: "ok" }), { timeout: 1_000 });
    expect(fetch).not.toHaveBeenCalled();
  }, 10_000);
  it("does not enqueue a late retry after the API has closed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture(); await f.app.ready(); await f.app.close(); apps.splice(apps.indexOf(f.app), 1);
    f.reject(new ProviderCopiesUnavailableError()); await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.fetchEntities).toHaveBeenCalledTimes(1);
  });
});
