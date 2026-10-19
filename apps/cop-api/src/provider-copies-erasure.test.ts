import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderCopiesErasure, ProviderCopiesUnavailableError, type ProviderLocalCopiesSource } from "./provider-copies-erasure.js";
import type { ProjectionFenceSnapshot, ProjectionResources } from "./resource-projection-erasure.js";
import { runtimeSubjectHash } from "./runtime-owner-erasure.js";
import { SituationDataSourceAdapter } from "./situation-data-source.js";
import { SafetyDataSourceAdapter } from "./safety-data-source.js";
import { TakGatewaySourceAdapter } from "./tak-gateway-source.js";
import { SimSearchDataSourceAdapter } from "./sim-search-data-source.js";

const issuer = "https://identity.example.test/realms/cop";
const actor = { issuer, subjectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" };
const resource = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const now = new Date("2026-10-14T08:00:00Z");
const bbox = { east: 15.35, north: 50.45, south: 49.65, west: 13.85 };
const empty: ProjectionResources = { reportIds: [], groupIds: [] };
const resources: ProjectionResources = { reportIds: [resource], groupIds: [] };
const snapshot: ProjectionFenceSnapshot = { resources: [], ownerHashes: [], subjectHashes: [], version: "provider-test-v1" };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function owner(sources: ProviderLocalCopiesSource[], frontier = snapshot, blocked = new Set<string>()) {
  return createProviderCopiesErasure({ sources, issuer, loadFences: async () => frontier, cachedGuard: {
    ready: () => true, assertActorAllowed: value => { expect(value.issuer).toBe(issuer); if (blocked.has(value.subjectId)) throw Object.assign(new Error("fenced"), { code: "ACCOUNT_ERASURE_FENCED" }); }
  } });
}
function eraseContext(operationId = "operation-a") { return { operationId, actor, signal: new AbortController().signal }; }
function collection(family: "situation" | "safety" | "tak", label = "Public reference") {
  const layer = family === "situation" ? "weather" : family === "safety" ? "warnings" : "mobile";
  return {
    contractVersion: `cop-${family}-source-v1`, type: "FeatureCollection", generatedAt: now.toISOString(),
    source: { sourceId: family === "tak" ? "tak-gateway-api" : `${family}-data-api`, sourceType: family === "tak" ? "TAK_COT_GATEWAY" : family === "safety" ? "PUBLIC_SAFETY_AGGREGATE" : "PUBLIC_SITUATION_AGGREGATE" },
    query: { bbox, layers: [layer], limit: 20 }, sources: [], summary: { featureCount: 1, sourceCount: 0, staleFeatureCount: 0, warningCount: 0 }, warnings: [],
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [14.42, 50.08] }, properties: { featureId: "public:one", category: "reference", label, headline: label, layer, sourceId: "public_reference", observedAt: now.toISOString(), validUntil: "2026-10-15T08:00:00Z", stale: false } }]
  };
}
function adapters(timeoutMs = 1000) {
  const config = { enabled: true, cacheTtlMs: 20000, maxLimit: 250, timeoutMs };
  return {
    situation: new SituationDataSourceAdapter({ ...config, baseUrl: "https://sim.example.test/situation-data/api/v1" }),
    safety: new SafetyDataSourceAdapter({ ...config, baseUrl: "https://sim.example.test/safety-data/api/v1" }),
    tak: new TakGatewaySourceAdapter({ ...config, baseUrl: "https://sim.example.test/tak-gateway/api/v1" }),
    search: new SimSearchDataSourceAdapter({ enabled: true, baseUrl: "https://sim.example.test/search-data/api/v1", indexLimit: 1000, maxLimit: 100, timeoutMs }, () => now)
  };
}
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }

describe("actual local provider copy erasure", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("revalidates a trusted frontier after a transport outlives the cached observation", async () => {
    const { situation } = adapters(); let valid = true;
    const refresh = vi.fn(async () => { valid = true; });
    vi.stubGlobal("fetch", vi.fn(async () => { valid = false; return new Response(JSON.stringify(collection("situation"))); }));
    const port = createProviderCopiesErasure({ sources: [situation], issuer, loadFences: async () => snapshot,
      cachedGuard: { ready: () => valid, refresh, assertActorAllowed: () => { if (!valid) throw Object.assign(new Error("expired"), { code: "ERASURE_STORE_UNAVAILABLE" }); } } });
    await port.init();
    expect((await situation.fetchFeatures({ bbox, layers: ["weather"], limit: 20 }, now)).features).toHaveLength(1);
    expect(refresh.mock.calls.length).toBeGreaterThan(1);
    expect(await port.ready()).toBe(true);
  });

  it("rejects a fetched result when durable frontier revalidation fails", async () => {
    const { situation } = adapters(); let advanced = false;
    vi.stubGlobal("fetch", vi.fn(async () => { advanced = true; return new Response(JSON.stringify(collection("situation"))); }));
    const port = createProviderCopiesErasure({ sources: [situation], issuer, loadFences: async () => snapshot,
      cachedGuard: { ready: () => !advanced, refresh: async () => { if (advanced) throw new Error("advanced frontier"); }, assertActorAllowed: () => {} } });
    await port.init();
    await expect(situation.fetchFeatures({ bbox, layers: ["weather"], limit: 20 }, now)).rejects.toBeInstanceOf(ProviderCopiesUnavailableError);
    expect(situation.cacheStats().entries).toBe(0);
    expect(await port.ready()).toBe(false);
  });

  it("clears the three actual feature caches at binding and erase, preserving public map responses and static source definitions", async () => {
    const { situation, safety, tak } = adapters();
    const fetch = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(collection(String(input).includes("situation") ? "situation" : String(input).includes("safety") ? "safety" : "tak"))));
    vi.stubGlobal("fetch", fetch);
    const queries = [() => situation.fetchFeatures({ bbox, layers: ["weather"], limit: 20 }, now), () => safety.fetchFeatures({ bbox, layers: ["warnings"], limit: 20 }, now), () => tak.fetchFeatures({ bbox, layers: ["mobile"], limit: 20 }, now)];
    const sources = [situation, safety, tak], staticSources = sources.map(value => value.sourceSystem);
    for (const query of queries) await query();
    expect(sources.map(value => value.cacheStats().entries)).toEqual([1, 1, 1]);
    const port = owner(sources); await port.init();
    expect(port.producerBindingInstalled()).toBe(true);
    expect(sources.map(value => value.cacheStats().entries)).toEqual([0, 0, 0]);
    for (const query of queries) { expect((await query()).features).toHaveLength(1); expect((await query()).cache?.status).toBe("hit"); }
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(await port.erase(resources, eraseContext())).toBe(true);
    expect(sources.map(value => value.cacheStats().entries)).toEqual([0, 0, 0]);
    for (const query of queries) expect((await query()).features).toHaveLength(1);
    sources.forEach((source, index) => expect(source.sourceSystem).toBe(staticSources[index]));
    expect(await port.preflight(actor)).toMatchObject({ ready: true });
  });

  it("clears actual catalog/layer/source projections and waits for their old catalog refresh", async () => {
    const { safety } = adapters();
    const catalog = { contractVersion: "provider-map-catalog-v1", providerId: "sim.safety-data", status: "online", layers: [], sources: [] };
    const response = deferred<Response>(); vi.stubGlobal("fetch", vi.fn(() => response.promise));
    const port = owner([safety]); await port.init();
    const pending = safety.fetchLayers(now).catch(error => error); await flush();
    expect(safety.providerCopiesBoundary().diagnostics().cacheInflight).toBe(1);
    expect(await port.erase(empty, eraseContext())).toBe(false);
    response.resolve(new Response(JSON.stringify(catalog))); expect(await pending).toBeInstanceOf(ProviderCopiesUnavailableError);
    expect(safety.providerCopiesBoundary().diagnostics()).toEqual({ cacheCopies: 0, activeCalls: 0, activeFetches: 0, cacheInflight: 0 });
    expect(await port.erase(empty, eraseContext())).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(catalog))));
    await safety.fetchLayers(now); await safety.fetchSources(now);
    expect(safety.providerCopiesBoundary().diagnostics().cacheCopies).toBe(3);
    expect(await port.erase(empty, eraseContext("operation-b"))).toBe(true);
    expect(safety.providerCopiesBoundary().diagnostics().cacheCopies).toBe(0);
  });

  it("keeps a timed-out search transport pending until its actual late fetch settles; it cannot return or refill", async () => {
    vi.useFakeTimers();
    const { search } = adapters(20), raw = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => raw.promise));
    const port = owner([search]); await port.init();
    const pending = search.fetchEntity("public:one", now).catch(error => error); await flush();
    await vi.advanceTimersByTimeAsync(21); expect(await pending).toBeInstanceOf(Error);
    expect(search.providerCopiesBoundary().diagnostics()).toMatchObject({ activeCalls: 0, activeFetches: 1 });
    expect(await port.erase(empty, eraseContext())).toBe(false);
    raw.resolve(new Response(JSON.stringify({ entity: null }))); await flush();
    expect(search.providerCopiesBoundary().diagnostics().activeFetches).toBe(0);
    expect(await port.erase(empty, eraseContext())).toBe(true);
  });

  it("keeps an unawaited response-body cancellation pending after timeout, until cancellation really completes", async () => {
    vi.useFakeTimers();
    const { search } = adapters(20), cancelled = deferred<void>();
    const body = new ReadableStream<Uint8Array>({ cancel: () => cancelled.promise });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const port = owner([search]); await port.init();
    const pending = search.fetchEntity("public:one", now).catch(error => error); await flush();
    await vi.advanceTimersByTimeAsync(21); await pending; await flush();
    expect(search.providerCopiesBoundary().diagnostics().activeFetches).toBeGreaterThan(0);
    expect(await port.erase(empty, eraseContext())).toBe(false);
    cancelled.resolve(); await flush();
    expect(search.providerCopiesBoundary().diagnostics().activeFetches).toBe(0);
    expect(await port.erase(empty, eraseContext())).toBe(true);
  });

  it("does not accept rejected body cancellation as settled evidence", async () => {
    const { tak } = adapters();
    const body = new ReadableStream<Uint8Array>({ cancel: () => Promise.reject(new Error("cancel unavailable")) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 500 })));
    const port = owner([tak]); await port.init();
    await expect(tak.fetchCatalog(now)).rejects.toThrow("500"); await flush();
    expect(tak.providerCopiesBoundary().diagnostics().activeFetches).toBe(1);
    expect(await port.ready()).toBe(false);
    expect(await port.preflight(actor)).toMatchObject({ ready: false });
    expect(await port.erase(empty, eraseContext())).toBe(false);
  });

  it("does not acknowledge failed cancellation of an oversized notification response", async () => {
    const { safety } = adapters();
    const body = new ReadableStream<Uint8Array>({ cancel: () => Promise.reject(new Error("cancel unavailable")) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-length": String(9 * 1024 * 1024) } })));
    const port = owner([safety]); await port.init();
    await expect(safety.fetchNotificationCandidates({ bbox, layers: ["warnings"], limit: 20 }, now)).rejects.toThrow("cancel unavailable");
    expect(safety.providerCopiesBoundary().diagnostics().activeFetches).toBe(1);
    expect(await port.preflight(actor)).toMatchObject({ ready: false });
    expect(await port.erase(empty, eraseContext())).toBe(false);
  });

  it("purges a warm actual cache as soon as the global actor fence is committed, before resource erasure runs", async () => {
    const { safety } = adapters(), blocked = new Set<string>(), port = owner([safety], snapshot, blocked); await port.init();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(collection("safety", actor.subjectId)))));
    await safety.fetchFeatures({ bbox, layers: ["warnings"], limit: 20 }, now);
    expect(safety.cacheStats().entries).toBe(1);
    blocked.add(actor.subjectId);
    expect(await port.ready()).toBe(true);
    expect(safety.cacheStats().entries).toBe(0);
    await expect(safety.fetchFeatures({ bbox, layers: ["warnings"], limit: 20 }, now)).rejects.toBeInstanceOf(ProviderCopiesUnavailableError);
  });

  it("denies raw target references using actual durable/global fences without trusting forged owner fields", async () => {
    const { situation } = adapters();
    const blocked = new Set<string>(), port = owner([situation], { ...snapshot, resources: [{ kind: "communityReport", id: resource }] }, blocked);
    await port.init();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...collection("situation", `Reference ${resource}`), owner: { issuer: "https://untrusted.example", subjectId: "someone-else" } }))));
    await expect(situation.fetchFeatures({ bbox, layers: ["weather"], limit: 20 }, now)).rejects.toBeInstanceOf(ProviderCopiesUnavailableError);
    expect(situation.cacheStats().entries).toBe(0);
    blocked.add(actor.subjectId);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(collection("situation", actor.subjectId)))));
    await expect(situation.fetchFeatures({ bbox, layers: ["weather"], limit: 20 }, now)).rejects.toBeInstanceOf(ProviderCopiesUnavailableError);
    expect(situation.cacheStats().entries).toBe(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(collection("situation")))));
    expect((await situation.fetchFeatures({ bbox, layers: ["weather"], limit: 20 }, now)).features).toHaveLength(1);
  });

  it("hydrates subject fences before producers, and public mutations cannot contaminate the immutable cache", async () => {
    const { safety } = adapters(), port = owner([safety], { ...snapshot, subjectHashes: [runtimeSubjectHash(actor.subjectId)] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(collection("safety")))));
    await expect(safety.fetchFeatures({ bbox, layers: ["warnings"], limit: 20 }, now)).rejects.toBeInstanceOf(ProviderCopiesUnavailableError);
    await port.init();
    const result = await safety.fetchFeatures({ bbox, layers: ["warnings"], limit: 20 }, now);
    result.features[0]!.properties.headline = actor.subjectId;
    expect((await safety.fetchFeatures({ bbox, layers: ["warnings"], limit: 20 }, now)).features[0]!.properties.headline).toBe("Public reference");
    expect(await port.ready()).toBe(true);
  });

  it("rejects unproved/subclass boundaries and does not let another controller overwrite an installed instance", async () => {
    const { safety } = adapters(), original = owner([safety]); await original.init();
    const second = owner([safety]); expect(second.producerBindingInstalled()).toBe(false); expect(await second.ready()).toBe(false);
    expect(await original.ready()).toBe(true);
    expect(await owner([{}]).ready()).toBe(false);
    class UnknownSafetySource extends SafetyDataSourceAdapter {}
    const unknown = new UnknownSafetySource(safety.config); expect(await owner([unknown]).ready()).toBe(false);
    expect(await owner([{ providerCopiesBoundary: () => safety.providerCopiesBoundary() }]).ready()).toBe(false);
  });

  it("does not starve a retry on new guarded unrelated public traffic after the old-generation barrier", async () => {
    const { safety } = adapters(), port = owner([safety]); await port.init();
    const oldResponse = deferred<Response>(), newResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => oldResponse.promise).mockImplementationOnce(() => newResponse.promise));
    const oldCall = safety.fetchCatalog(now).catch(error => error); await flush();
    expect(await port.erase(empty, eraseContext())).toBe(false);
    oldResponse.resolve(new Response(JSON.stringify({ contractVersion: "provider-map-catalog-v1", providerId: "sim.safety-data", status: "online", layers: [], sources: [] })));
    expect(await oldCall).toBeInstanceOf(ProviderCopiesUnavailableError);
    const newCall = safety.fetchFeatures({ bbox, layers: ["warnings"], limit: 20 }, now); await flush();
    expect(safety.providerCopiesBoundary().diagnostics().activeFetches).toBe(1);
    expect(await port.erase(empty, eraseContext())).toBe(true);
    newResponse.resolve(new Response(JSON.stringify(collection("safety"))));
    expect((await newCall).features).toHaveLength(1);
  });
});
