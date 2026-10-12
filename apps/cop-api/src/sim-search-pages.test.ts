import { describe, expect, it } from "vitest";
import { combineSimSearchPages, simSearchHealthMetadata } from "./sim-search-pages.js";
import type { SimSearchEntitiesResponse } from "./sim-search-data-source.js";
import { buildSimSearchDataHealth } from "./sim-search-data-source.js";

const receivedAt = new Date("2026-10-12T18:00:00Z");
const page = (generatedAt?: string): SimSearchEntitiesResponse => ({
  contractVersion: "sim-search-source-v1",
  ...(generatedAt ? { generatedAt } : {}),
  providerId: "sim.search-data",
  results: [{ entityType: "public_resource", providerEntityId: "synthetic-id", title: "Synthetic", stale: true }],
  summary: { resultCount: 1, staleResultCount: 8, warningCount: 0 },
  warnings: [],
  warningsKnown: true
});

describe("SIM search index page provenance", () => {
  it("preserves oldest feed timestamp and separately records receipt and page scopes", () => {
    const result = combineSimSearchPages(
      [page("2026-10-12T17:59:00Z"), page("2026-10-12T17:55:00Z")],
      1000,
      receivedAt
    );
    expect(result.response.generatedAt).toBe("2026-10-12T17:55:00.000Z");
    expect(result.metadata).toEqual({
      pageCount: 2,
      pageStaleCount: 2,
      providerGeneratedAtKnown: true,
      providerNewestGeneratedAt: "2026-10-12T17:59:00.000Z",
      providerOldestGeneratedAt: "2026-10-12T17:55:00.000Z",
      receivedAt: receivedAt.toISOString(),
      responseScope: "entities-index",
      returnedCount: 2,
      warningCount: 0,
      warningsKnown: true,
      providerFreshnessKnown: false,
      providerFreshnessTimestampState: "unknown",
      consumptionExpiryKnown: false
    });
    expect(result.response.summary.staleResultCount).toBe(16);
    expect(JSON.stringify(result.metadata)).not.toMatch(/synthetic-id|Synthetic|public_resource/);
  });

  it.each([undefined, "invalid timestamp"])("does not certify all-page age when one timestamp is %s", (timestamp) => {
    const result = combineSimSearchPages([page("2026-10-12T17:55:00Z"), page(timestamp)], 1000, receivedAt);
    expect(result.response.generatedAt).toBeUndefined();
    expect(result.metadata.providerGeneratedAtKnown).toBe(false);
    expect(result.metadata.providerOldestGeneratedAt).toBe("2026-10-12T17:55:00.000Z");
    expect(result.metadata.receivedAt).toBe(receivedAt.toISOString());
  });

  it("keeps missing warning provenance unknown and never certifies empty pages as fresh", () => {
    const unknownPage = page();
    delete unknownPage.warningsKnown;
    expect(combineSimSearchPages([unknownPage], 1000, receivedAt).metadata.warningsKnown).toBe(false);
    const empty = combineSimSearchPages([], 1000, receivedAt);
    expect(empty.response.generatedAt).toBeUndefined();
    expect(empty.metadata).toMatchObject({ pageCount: 0, providerGeneratedAtKnown: false, warningsKnown: false });
  });

  it.each(["providerId", "contractVersion"] as const)("rejects different page %s before combining entities", (key) => {
    const mismatch = { ...page(), [key]: "other" };
    expect(() => combineSimSearchPages([page(), mismatch], 1000, receivedAt)).toThrow(
      "SIM_SEARCH_PAGE_CONTRACT_MISMATCH"
    );
  });

  it("keeps provider cache evaluation distinct from COP consumption expiry across pages", () => {
    const oldPage = page("2026-10-12T17:55:00Z");
    oldPage.freshness = {
      scope: "returned_entities",
      evaluatedAt: "2026-10-12T17:56:00Z",
      feedTimestampState: "valid",
      feedAgeSeconds: 60,
      returnedExpiredCount: 0,
      returnedStaleCount: 0,
      missingExpiryCount: 0,
      invalidExpiryCount: 0
    };
    oldPage.consumptionExpiry = {
      scope: "returned_entities",
      derivation: "COP_DERIVED",
      evaluatedAt: receivedAt.toISOString(),
      expiredCount: 1,
      missingExpiryCount: 0,
      invalidExpiryCount: 0
    };
    const result = combineSimSearchPages([oldPage, oldPage], 1000, receivedAt);
    expect(result.metadata).toMatchObject({
      providerFreshnessKnown: true,
      providerFreshnessOldestEvaluatedAt: "2026-10-12T17:56:00.000Z",
      consumptionExpiryKnown: true
    });
    expect(result.response.consumptionExpiry).toMatchObject({
      evaluatedAt: receivedAt.toISOString(),
      expiredCount: 2,
      derivation: "COP_DERIVED"
    });
    expect(result.response.generatedAt).toBe("2026-10-12T17:55:00.000Z");
    expect(oldPage.freshness.returnedExpiredCount).toBe(0);
  });

  it("logs only scoped technical metadata and never arbitrary summary, warning or error text", () => {
    const result = simSearchHealthMetadata({
      health: "DEGRADED",
      evaluatedAt: receivedAt.toISOString(),
      lastError: "private text",
      warnings: ["private warning"],
      summary: {
        responseScope: "query",
        resultCount: 1,
        staleResultCount: null,
        pageCount: -1,
        secret: "private value",
        warningsKnown: false,
        consumptionExpiry: {
          scope: "returned_entities",
          derivation: "COP_DERIVED",
          evaluatedAt: receivedAt.toISOString(),
          expiredCount: 1,
          missingExpiryCount: 0,
          invalidExpiryCount: 0,
          private: "private row"
        }
      }
    });
    expect(result).toMatchObject({ state: "DEGRADED", resultCount: 1, responseScope: "query", warningsKnown: false });
    expect(result.staleResultCount).toBeUndefined();
    expect(result.pageCount).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("private");
    expect(simSearchHealthMetadata(undefined)).toEqual({ state: "unknown" });
  });

  it("rechecks an earlier page that expires while subsequent index pages arrive", () => {
    const first = page("2026-10-12T17:55:00Z");
    first.results = [{ ...first.results[0]!, stale: false, expiresAt: "2026-10-12T17:59:20Z" }];
    first.summary.staleResultCount = 0;
    first.consumptionExpiry = {
      scope: "returned_entities",
      derivation: "COP_DERIVED",
      evaluatedAt: "2026-10-12T17:59:00Z",
      expiredCount: 0,
      missingExpiryCount: 0,
      invalidExpiryCount: 0
    };
    const second = {
      ...first,
      results: [{ ...first.results[0]!, expiresAt: "2026-10-12T18:10:00Z" }],
      consumptionExpiry: { ...first.consumptionExpiry, evaluatedAt: "2026-10-12T18:00:00Z" }
    };
    const { response, metadata } = combineSimSearchPages([first, second], 1000, receivedAt);
    expect(response.results.map((entity) => entity.stale)).toEqual([true, false]);
    expect(first.results[0]?.stale).toBe(false);
    expect(response.consumptionExpiry).toMatchObject({ evaluatedAt: receivedAt.toISOString(), expiredCount: 1 });
    expect(response.generatedAt).toBe("2026-10-12T17:55:00.000Z");
    expect(metadata.pageStaleCount).toBe(1);
    expect(buildSimSearchDataHealth(response, receivedAt).health).toBe("DEGRADED");
  });

  it.each([{ toString: "private", content: "private" }, ["valid"]])(
    "rejects coerced enum values and strips free text from accepted dates",
    (value) => {
      const metadata = simSearchHealthMetadata({
        health: "ONLINE",
        evaluatedAt: receivedAt.toISOString(),
        generatedAt: "Mon, 12 Oct 2026 17:00:00 GMT (private date comment)",
        summary: {
          receivedAt: "Mon, 12 Oct 2026 18:00:00 GMT (private date comment)",
          providerFreshnessTimestampState: value
        }
      });
      expect(metadata.providerFreshnessTimestampState).toBeUndefined();
      expect(metadata.generatedAt).toBe("2026-10-12T17:00:00.000Z");
      expect(metadata.receivedAt).toBe(receivedAt.toISOString());
      expect(JSON.stringify(metadata)).not.toContain("private");
    }
  );
});
