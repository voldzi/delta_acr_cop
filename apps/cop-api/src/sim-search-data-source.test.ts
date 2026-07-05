import { afterEach, describe, expect, it, vi } from "vitest";
import { SimSearchDataSourceAdapter } from "./sim-search-data-source.js";

describe("SimSearchDataSourceAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});

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
