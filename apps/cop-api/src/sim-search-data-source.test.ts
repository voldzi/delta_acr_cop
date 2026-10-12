import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSimSearchDataHealth, SimSearchDataSourceAdapter } from "./sim-search-data-source.js";

describe("SimSearchDataSourceAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("proxies SIM search-data query, entities, detail, taxonomy and observability server-side", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).not.toMatchObject({ Authorization: expect.any(String) });
      if (url.endsWith("/query")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          entityTypes: ["police_station"],
          limit: 10,
          text: "policie Vrbno"
        });
        return new Response(JSON.stringify(sampleSearchResponse()), { status: 200 });
      }
      if (url.includes("/entities?")) {
        return new Response(JSON.stringify({
          ...sampleSearchResponse(),
          nextCursor: "cursor-2"
        }), { status: 200 });
      }
      if (url.endsWith("/entities/police%3Acz%3Avrbno-obvodni")) {
        return new Response(JSON.stringify({ entity: sampleEntity() }), { status: 200 });
      }
      if (url.endsWith("/taxonomy")) {
        return new Response(JSON.stringify({
          contractVersion: "sim-search-taxonomy-v1",
          providerId: "sim.search-data",
          taxonomies: []
        }), { status: 200 });
      }
      if (url.endsWith("/observability")) {
        return new Response(JSON.stringify({
          generatedAt: "2026-07-05T12:00:00Z",
          status: "ok",
          summary: { entityCount: 1 },
          warnings: []
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SimSearchDataSourceAdapter({
      baseUrl: "https://sim.example.test/search-data/api/v1/",
      enabled: true,
      indexLimit: 1000,
      maxLimit: 100,
      timeoutMs: 6000
    });
    const requestNow = new Date("2026-07-05T12:00:00Z");

    const query = await adapter.query({
      entityTypes: ["police_station"],
      limit: 10,
      sourceSystems: ["osm_reference"],
      text: "policie Vrbno",
      validAt: requestNow.toISOString()
    }, requestNow);
    const entities = await adapter.fetchEntities({ cursor: "cursor-1", limit: 1000 }, requestNow);
    const entity = await adapter.fetchEntity("police:cz:vrbno-obvodni", requestNow);
    const taxonomy = await adapter.fetchTaxonomy(requestNow);
    const observability = await adapter.fetchObservability(requestNow);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.example.test/search-data/api/v1/query");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://sim.example.test/search-data/api/v1/entities?limit=1000&cursor=cursor-1");
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe("https://sim.example.test/search-data/api/v1/entities/police%3Acz%3Avrbno-obvodni");
    expect(String(fetchMock.mock.calls[3]?.[0])).toBe("https://sim.example.test/search-data/api/v1/taxonomy");
    expect(String(fetchMock.mock.calls[4]?.[0])).toBe("https://sim.example.test/search-data/api/v1/observability");
    expect(query).toMatchObject({
      contractVersion: "sim-search-source-v1",
      providerId: "sim.search-data",
      results: [
        expect.objectContaining({
          allowedUse: ["ai_context", "map_display"],
          dataQuality: "verified_reference",
          handling: {
            reference_not_operational_status: true
          },
          metrics: {
            distanceM: 1800
          },
          providerEntityId: "police:cz:vrbno-obvodni",
          sourceSystem: "osm_reference"
        })
      ]
    });
    expect(entities.nextCursor).toBe("cursor-2");
    expect(entity).toMatchObject({
      providerEntityId: "police:cz:vrbno-obvodni",
      title: "Policie ČR - Obvodní oddělení Vrbno pod Pradědem"
    });
    expect(taxonomy).toMatchObject({ providerId: "sim.search-data" });
    expect(observability).toMatchObject({ status: "ok" });
  });

  it("retains SIM observability reachability separately from source quality and whitelists cache counters", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      serviceId: "search-data-api",
      contractVersion: "sim-search-source-v1",
      providerId: "sim.search-data",
      generatedAt: "2026-10-12T17:00:00Z",
      status: "ok",
      dataQualityStatus: "degraded",
      degradedSourceCount: 1,
      sources: [{
        sourceSystem: "safety_data",
        status: "degraded",
        dataQualityStatus: "degraded",
        entityCount: 8,
        staleCount: 2,
        lastSuccessAt: "2026-10-12T16:59:00Z",
        warnings: ["Synthetic internal provider message"]
      }],
      cache: { entries: 3, inflight: 0, maxEntries: 16, hits: 10, misses: 2, hitRate: 0.8333, staleHits: 2, refreshes: 5, errors: 1, evictions: 0, unapproved: "synthetic secret" },
      capabilities: { browserDirectAccess: false }
    }))));
    const observability = await testAdapter().fetchObservability(new Date("2026-10-12T17:00:10Z"));
    expect(observability).toMatchObject({
      status: "ok", dataQualityStatus: "degraded", degradedSourceCount: 1,
      sources: [{ sourceSystem: "safety_data", status: "degraded", dataQualityStatus: "degraded", entityCount: 8, staleCount: 2, lastSuccessAt: "2026-10-12T16:59:00Z", warningCount: 1 }],
      cache: { entries: 3, inflight: 0, maxEntries: 16, hits: 10, misses: 2, hitRate: 0.8333, staleHits: 2, refreshes: 5, errors: 1, evictions: 0 },
      sourcesKnown: true, warningsKnown: false
    });
    expect(observability.cache).not.toHaveProperty("unapproved");
    expect(observability.sources?.[0]).not.toHaveProperty("warnings");
    const health = buildSimSearchDataHealth(observability, new Date("2026-10-12T17:00:10Z"));
    expect(health).toMatchObject({ health: "ONLINE", summary: { serviceStatus: "ok", dataQualityStatus: "degraded", degradedSourceCount: 1, warningsKnown: false } });
    expect(health.summary).not.toHaveProperty("freshness");
  });

  it("leaves missing and malformed counters, quality, timestamps and warning counts unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "ok", generatedAt: "2026-02-30T10:00:00Z", dataQualityStatus: "fresh", degradedSourceCount: null,
      sources: [{ sourceSystem: "osm_reference", status: "unknown-state", entityCount: null, staleCount: "0", lastSuccessAt: "not-a-date" }],
      cache: { entries: null, inflight: "0", maxEntries: -1, hits: 1.5, misses: true, hitRate: 2, staleHits: 0, refreshes: 5 }, warnings: [0]
    }))));
    const observability = await testAdapter().fetchObservability(new Date("2026-10-12T17:00:00Z"));
    expect(observability.generatedAt).toBeUndefined();
    expect(observability.dataQualityStatus).toBeUndefined();
    expect(observability.degradedSourceCount).toBeUndefined();
    expect(observability.sourcesKnown).toBe(false);
    expect(observability.cache).toEqual({ staleHits: 0, refreshes: 5 });
    expect(observability.sources?.[0]).toMatchObject({ status: "unknown" });
    expect(observability.sources?.[0]?.entityCount).toBeUndefined();
    expect(observability.sources?.[0]?.staleCount).toBeUndefined();
    expect(observability.sources?.[0]?.warningCount).toBeUndefined();
    expect(observability.sources?.[0]?.lastSuccessAt).toBeUndefined();
    expect(buildSimSearchDataHealth(observability, new Date("2026-10-12T17:00:00Z"))).toMatchObject({ generatedAt: undefined, summary: { dataQualityStatus: "unknown", warningsKnown: false } });
  });

  it("preserves source-origin page time instead of inventing a current timestamp", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(sampleSearchResponse())))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...sampleSearchResponse(), generatedAt: undefined, warnings: undefined })));
    vi.stubGlobal("fetch", fetchMock);
    const requestNow = new Date("2026-10-12T17:00:00Z");
    const sourcePage = await testAdapter().fetchEntities({}, requestNow);
    const unknownPage = await testAdapter().fetchEntities({}, requestNow);
    expect(sourcePage.generatedAt).toBe("2026-07-05T12:00:00Z");
    expect(unknownPage.generatedAt).toBeUndefined();
    expect(unknownPage.warningsKnown).toBe(false);
    expect(buildSimSearchDataHealth(unknownPage, requestNow).generatedAt).toBeUndefined();
  });

  it.each([undefined, "fresh"])("does not derive known data quality from successful reachability: %s", async (dataQualityStatus) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok", sources: [], dataQualityStatus }))));
    const observability = await testAdapter().fetchObservability(new Date("2026-10-12T17:00:00Z"));
    expect(observability.dataQualityStatus).toBeUndefined();
    expect(buildSimSearchDataHealth(observability, new Date("2026-10-12T17:00:00Z"))).toMatchObject({ health: "ONLINE", generatedAt: undefined, summary: { serviceStatus: "ok", dataQualityStatus: "unknown" } });
  });

  it("keeps optional SIM returned-page freshness separate from collection counts", async () => {
    const freshness = sampleFreshness();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...sampleSearchResponse(), results: undefined, entities: [sampleEntity()],
      summary: { entityCount: 1200, returnedCount: 1, staleEntityCount: 99, warningCount: 0 }, freshness
    }))));
    const page = await testAdapter().fetchEntities({}, new Date("2026-10-12T17:00:00Z"));
    expect(page.freshness).toEqual(freshness);
    expect(page.summary).toMatchObject({ resultCount: 1, staleResultCount: 0 });
  });

  it("projects known expiry at COP consumption without rewriting cached provider freshness or origin", async () => {
    const freshness = { ...sampleFreshness(), evaluatedAt: "2026-10-12T16:59:00Z", missingExpiryCount: 0 };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...sampleSearchResponse(), generatedAt: "2026-10-12T16:58:00Z", freshness,
      results: [{ ...sampleEntity(), stale: false, status: "active", expiresAt: "2026-10-12T16:59:30Z", validUntil: "2026-10-12T17:00:30Z", sourceRevision: "synthetic-r1", updatedAt: "2026-10-12T16:57:00Z" }],
      summary: { resultCount: 1, staleResultCount: 0, warningCount: 0, staleEntityCount: 100 }
    }))));
    const now = new Date("2026-10-12T17:00:00Z");
    const page = await testAdapter().fetchEntities({}, now);
    expect(page.results[0]).toMatchObject({ stale: true, status: "active", expiresAt: "2026-10-12T16:59:30Z", validUntil: "2026-10-12T17:00:30Z", sourceRevision: "synthetic-r1", updatedAt: "2026-10-12T16:57:00Z" });
    expect(page.generatedAt).toBe("2026-10-12T16:58:00Z");
    expect(page.freshness).toEqual(freshness);
    expect(page.summary).toMatchObject({ resultCount: 1, staleResultCount: 1 });
    expect(page.consumptionExpiry).toEqual({ scope: "returned_entities", derivation: "COP_DERIVED", evaluatedAt: now.toISOString(), expiredCount: 1, missingExpiryCount: 0, invalidExpiryCount: 0 });
    expect(buildSimSearchDataHealth(page, now)).toMatchObject({ health: "DEGRADED", summary: { consumptionExpiry: page.consumptionExpiry, providerFreshness: freshness } });
  });

  it.each(["query", "entities", "detail"])("uses the clock after the full %s body arrives when expiry is crossed in transit", async (operation) => {
    vi.useFakeTimers();
    const requestStart = new Date("2026-10-12T17:00:00Z");
    vi.setSystemTime(requestStart);
    const expired = { ...sampleEntity(), providerEntityId: "synthetic-expired", stale: false, status: "active", expiresAt: "2026-10-12T17:00:00.500Z", updatedAt: "2026-10-12T16:59:00Z" };
    const future = { ...sampleEntity(), providerEntityId: "synthetic-future", stale: false, status: "active", expiresAt: "2026-10-12T17:00:05Z" };
    const freshness = { ...sampleFreshness(), evaluatedAt: requestStart.toISOString(), missingExpiryCount: 0 };
    const responseValue = operation === "detail" ? { entity: expired } : {
      ...sampleSearchResponse(), generatedAt: "2026-10-12T16:59:00Z", results: [expired, future], freshness,
      summary: { resultCount: 2, staleResultCount: 0, warningCount: 0 }
    };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "X-COP-Request-At": requestStart.toISOString() });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(responseValue)));
          controller.close();
        }, 1000);
      } }));
    }));
    const clock = vi.fn(() => new Date());
    const adapter = testAdapter(6000, clock);
    const request = operation === "query" ? adapter.query({ text: "synthetic" }, requestStart)
      : operation === "entities" ? adapter.fetchEntities({}, requestStart) : adapter.fetchEntity("synthetic-expired", requestStart);
    expect(clock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    const response = await request;
    expect(clock).toHaveBeenCalledTimes(1);
    if (operation === "detail") {
      expect(response).toMatchObject({ stale: true, status: "active", expiresAt: "2026-10-12T17:00:00.500Z", updatedAt: "2026-10-12T16:59:00Z" });
    } else {
      expect(response).toMatchObject({
        generatedAt: "2026-10-12T16:59:00Z", freshness,
        results: [{ providerEntityId: "synthetic-expired", stale: true }, { providerEntityId: "synthetic-future", stale: false }],
        consumptionExpiry: { evaluatedAt: "2026-10-12T17:00:01.000Z", expiredCount: 1, missingExpiryCount: 0, invalidExpiryCount: 0 }
      });
    }
  });

  it.each([
    { expiresAt: "2026-10-12T16:59:00Z" },
    { validUntil: "2026-10-12T16:59:00Z" },
    { expiresAt: "2026-10-12T17:00:00Z" },
    { status: "expired", expiresAt: "2026-10-12T17:01:00Z" }
  ])("projects query and detail expiry from a known elapsed deadline or expired status: %j", async (expiry) => {
    const entity = { ...sampleEntity(), stale: false, ...expiry };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...sampleSearchResponse(), results: [entity] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entity })));
    vi.stubGlobal("fetch", fetchMock);
    const now = new Date("2026-10-12T17:00:00Z");
    const page = await testAdapter().query({ text: "synthetic" }, now);
    const detail = await testAdapter().fetchEntity("synthetic", now);
    expect(page.results[0]?.stale).toBe(true);
    expect(detail?.stale).toBe(true);
    expect(detail?.status).toBe(entity.status);
    expect(page.consumptionExpiry?.expiredCount).toBe(1);
    expect(buildSimSearchDataHealth(page, now).health).toBe("DEGRADED");
  });

  it("preserves unknown reference expiry without treating it as a source outage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...sampleSearchResponse(), results: [{ ...sampleEntity(), stale: false, status: "reference" }] }))));
    const now = new Date("2026-10-12T17:00:00Z");
    const page = await testAdapter().fetchEntities({}, now);
    expect(page.results[0]?.stale).toBe(false);
    expect(page.consumptionExpiry).toMatchObject({ expiredCount: 0, missingExpiryCount: 1, invalidExpiryCount: 0 });
    expect(buildSimSearchDataHealth(page, now).health).toBe("ONLINE");
  });

  it.each([false, true])("treats explicit nullable reference deadlines as absent and preserves stale=%s", async (stale) => {
    const entity = { ...sampleEntity(), sourceSystem: "osm_reference", sourceAuthority: "reference", status: "active", stale, validUntil: null, expiresAt: null };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...sampleSearchResponse(), results: [entity] }))));
    const now = new Date("2026-10-12T17:00:00Z");
    const page = await testAdapter().fetchEntities({}, now);
    expect(page.consumptionExpiry).toMatchObject({ expiredCount: 0, missingExpiryCount: 1, invalidExpiryCount: 0 });
    expect(page.results[0]).toMatchObject({ stale, status: "active", sourceSystem: "osm_reference", sourceAuthority: "reference" });
    expect(buildSimSearchDataHealth(page, now).health).toBe(stale ? "DEGRADED" : "ONLINE");
  });

  it.each([
    { validUntil: "2026-10-12T16:59:59Z", expiredCount: 1, invalidExpiryCount: 0 },
    { validUntil: "2026-10-12T17:00:01Z", expiredCount: 0, invalidExpiryCount: 0 },
    { validUntil: "invalid", expiredCount: 0, invalidExpiryCount: 1 }
  ])("ignores one null deadline while retaining the other deadline classification: $validUntil", async ({ validUntil, expiredCount, invalidExpiryCount }) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...sampleSearchResponse(), results: [{ ...sampleEntity(), stale: false, expiresAt: null, validUntil }] }))));
    const now = new Date("2026-10-12T17:00:00Z");
    const page = await testAdapter().fetchEntities({}, now);
    expect(page.consumptionExpiry).toMatchObject({ expiredCount, missingExpiryCount: 0, invalidExpiryCount });
    expect(page.results[0]?.stale).toBe(expiredCount > 0);
  });

  it.each(["", "not-a-date", "2026-02-30T17:00:00Z", 12, false])("reports invalid expiry as unknown while retaining an already-stale flag: %j", async (expiresAt) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...sampleSearchResponse(), results: [{ ...sampleEntity(), stale: true, expiresAt }] }))));
    const now = new Date("2026-10-12T17:00:00Z");
    const page = await testAdapter().fetchEntities({}, now);
    expect(page.results[0]?.stale).toBe(true);
    expect(page.consumptionExpiry).toMatchObject({ expiredCount: 0, missingExpiryCount: 0, invalidExpiryCount: 1 });
    expect(buildSimSearchDataHealth(page, now)).toMatchObject({ health: "DEGRADED", summary: { consumptionExpiry: { invalidExpiryCount: 1 } } });
  });

  it("keeps invalid expiry unknown and emits only whitelisted derived metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...sampleSearchResponse(), results: [{ ...sampleEntity(), stale: false, expiresAt: "invalid" }] }))));
    const now = new Date("2026-10-12T17:00:00Z");
    const page = await testAdapter().fetchEntities({}, now);
    expect(page.results[0]?.stale).toBe(false);
    expect(page.consumptionExpiry).toMatchObject({ expiredCount: 0, invalidExpiryCount: 1 });
    Object.assign(page.consumptionExpiry ?? {}, { unapproved: "synthetic private text" });
    const health = buildSimSearchDataHealth(page, now);
    expect(health.health).toBe("ONLINE");
    expect(health.summary?.consumptionExpiry).not.toHaveProperty("unapproved");
  });

  it.each([null, -1, 0.5, Number.POSITIVE_INFINITY, 0])("never hides a stale returned entity behind invalid or conflicting summary count %s", async (staleResultCount) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...sampleSearchResponse(), results: [{ ...sampleEntity(), stale: true }], summary: { resultCount: 0, staleResultCount }
    }))));
    const page = await testAdapter().query({ text: "synthetic" }, new Date("2026-10-12T17:00:00Z"));
    expect(page.summary).toMatchObject({ resultCount: 1, staleResultCount: 1 });
    expect(buildSimSearchDataHealth(page, new Date("2026-10-12T17:00:00Z")).health).toBe("DEGRADED");
  });

  it("preserves larger valid provider-reported counts separately from actual page size", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...sampleSearchResponse(), results: [{ ...sampleEntity(), stale: true }], summary: { resultCount: 100, staleResultCount: 20, staleEntityCount: 200 }
    }))));
    const page = await testAdapter().fetchEntities({}, new Date("2026-10-12T17:00:00Z"));
    expect(page.results).toHaveLength(1);
    expect(page.summary).toMatchObject({ resultCount: 100, staleResultCount: 20 });
    expect(buildSimSearchDataHealth(page, new Date("2026-10-12T17:00:00Z")).health).toBe("DEGRADED");
  });

  it.each([null, -1, 0.5, Number.POSITIVE_INFINITY, 0])("health preserves actual stale flags even for injected adapter summary count %s", (staleResultCount) => {
    const response = { contractVersion: "sim-search-source-v1", providerId: "sim.search-data", results: [{ ...sampleEntity(), entityType: "police_station", providerEntityId: "synthetic", title: "Synthetic", stale: true }], summary: { resultCount: 0, staleResultCount: staleResultCount as number, warningCount: 0 }, warnings: [] };
    const health = buildSimSearchDataHealth(response, new Date("2026-10-12T17:00:00Z"));
    expect(health.health).toBe("DEGRADED");
    expect(health.summary).toMatchObject({ resultCount: 1, staleResultCount: 1 });
  });

  it("cancels a native non-success response without awaiting stalled cleanup", async () => {
    let cancelled = false;
    let signal: AbortSignal | null | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode("synthetic private body")); },
        cancel() { cancelled = true; return new Promise<void>(() => {}); }
      }), { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(testAdapter(20).query({ text: "synthetic" }, new Date("2026-10-12T17:00:00Z"))).rejects.toMatchObject({ status: 503, message: "SIM search-data request returned HTTP 503." });
    expect(cancelled).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { feedTimestampState: "future", feedAgeSeconds: 0 },
    { feedTimestampState: "invalid", feedAgeSeconds: 0 },
    { feedAgeSeconds: -1 },
    { returnedStaleCount: 2 },
    { returnedExpiredCount: null },
    { invalidExpiryCount: "0" },
    { missingExpiryCount: undefined },
    { evaluatedAt: "2026-02-30T10:00:00Z" },
    { scope: "collection" }
  ])("omits malformed page freshness without fabricating certainty: %j", async (invalid) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...sampleSearchResponse(), freshness: { ...sampleFreshness(), ...invalid } }))));
    const page = await testAdapter().fetchEntities({}, new Date("2026-10-12T17:00:00Z"));
    expect(page.freshness).toBeUndefined();
  });

  it.each(["future", "invalid"])("preserves unknown feed age for %s provider timestamp state", async (feedTimestampState) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...sampleSearchResponse(), freshness: { ...sampleFreshness(), feedTimestampState, feedAgeSeconds: null } }))));
    const page = await testAdapter().fetchEntities({}, new Date("2026-10-12T17:00:00Z"));
    expect(page.freshness).toMatchObject({ feedTimestampState, feedAgeSeconds: null });
  });

  it("enforces the deadline after response headers and cancels a stalled body without retry", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    let cancelled = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
        cancel() { cancelled = true; }
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const query = testAdapter(20).query({ text: "synthetic" }, new Date("2026-10-12T17:00:00Z"));
    const rejection = expect(query).rejects.toThrow("SIM search-data request timed out.");
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("rejects redirects and sanitizes provider errors without exposing URL or text", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("synthetic upstream secret https://private.example.test");
    }));
    await expect(testAdapter().fetchObservability(new Date("2026-10-12T17:00:00Z"))).rejects.toThrow("SIM search-data transport failed.");
  });

  it("bounds a stalled fetch before headers without increasing retries", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const rejection = expect(testAdapter(20).fetchObservability(new Date("2026-10-12T17:00:00Z"))).rejects.toThrow("SIM search-data request timed out.");
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    () => new Response("synthetic private response body", { status: 503, statusText: "synthetic private status" }),
    () => new Response("synthetic private response body"),
    () => new Response("{}", { headers: { "content-length": String(16 * 1024 * 1024 + 1) } }),
    () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1)); controller.close(); } }))
  ])("rejects error, malformed and oversized responses with safe messages", async (response) => {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    await expect(testAdapter().query({ text: "synthetic" }, new Date("2026-10-12T17:00:00Z"))).rejects.toThrow(/^SIM search-data (?:request returned HTTP 503\.|response is not valid JSON\.|response exceeded the size limit\.)$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function testAdapter(timeoutMs = 6000, clock: () => Date = () => new Date("2026-10-12T17:00:00Z")): SimSearchDataSourceAdapter {
  return new SimSearchDataSourceAdapter({ baseUrl: "https://sim.example.test/search-data/api/v1", enabled: true, indexLimit: 1000, maxLimit: 100, timeoutMs }, clock);
}

function sampleFreshness(): Record<string, unknown> {
  return { scope: "returned_entities", evaluatedAt: "2026-10-12T17:00:00Z", feedTimestampState: "valid", feedAgeSeconds: 5, returnedStaleCount: 0, returnedExpiredCount: 0, missingExpiryCount: 1, invalidExpiryCount: 0 };
}

function sampleSearchResponse(): Record<string, unknown> {
  return {
    contractVersion: "sim-search-source-v1",
    generatedAt: "2026-07-05T12:00:00Z",
    providerId: "sim.search-data",
    query: {
      text: "policie Vrbno"
    },
    results: [sampleEntity()],
    summary: {
      resultCount: 1,
      staleResultCount: 0,
      warningCount: 0
    },
    warnings: []
  };
}

function sampleEntity(): Record<string, unknown> {
  return {
    address: {
      countryCode: "CZ",
      municipality: "Vrbno pod Pradědem"
    },
    aliases: ["Policie Vrbno"],
    allowedUse: ["ai_context", "map_display"],
    centroid: {
      lat: 50.12076,
      lon: 17.38413
    },
    classification: {
      level: "UNCLASSIFIED"
    },
    confidence: 0.94,
    dataQuality: "verified_reference",
    entityType: "police_station",
    handling: {
      reference_not_operational_status: true
    },
    layerIds: ["public.security.police"],
    metrics: {
      distanceM: 1800
    },
    positionQuality: {
      method: "centroid"
    },
    providerEntityId: "police:cz:vrbno-obvodni",
    providerId: "sim.search-data",
    sourceAuthority: "reference",
    sourceSystem: "osm_reference",
    status: "reference",
    summary: "Referenční objekt policejní služebny.",
    title: "Policie ČR - Obvodní oddělení Vrbno pod Pradědem",
    visibility: "public"
  };
}
