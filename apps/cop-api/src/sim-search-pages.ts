import { projectSimSearchEntitiesForConsumption, type SimSearchEntitiesResponse } from "./sim-search-data-source.js";
import type { SourceHealthOverride } from "./types.js";

export interface SimSearchPageMetadata {
  pageCount: number;
  pageStaleCount: number;
  providerGeneratedAtKnown: boolean;
  providerNewestGeneratedAt?: string;
  providerOldestGeneratedAt?: string;
  receivedAt: string;
  responseScope: "entities-index";
  returnedCount: number;
  warningCount: number;
  warningsKnown: boolean;
  providerFreshnessKnown: boolean;
  providerFreshnessTimestampState: "valid" | "future" | "invalid" | "unknown";
  providerFreshnessOldestEvaluatedAt?: string;
  providerFreshnessNewestEvaluatedAt?: string;
  consumptionExpiryKnown: boolean;
}

/** Keep feed generation time separate from the time COP received the pages. */
export function combineSimSearchPages(
  responses: SimSearchEntitiesResponse[],
  limit: number,
  receivedAt: Date
): { metadata: SimSearchPageMetadata; response: SimSearchEntitiesResponse } {
  const providerId = responses[0]?.providerId ?? "sim.search-data";
  const contractVersion = responses[0]?.contractVersion ?? "sim-search-source-v1";
  if (responses.some((page) => page.providerId !== providerId || page.contractVersion !== contractVersion)) {
    throw new Error("SIM_SEARCH_PAGE_CONTRACT_MISMATCH");
  }
  const timestamps = responses
    .flatMap((page) => {
      const value = page.generatedAt;
      const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
      return Number.isFinite(time) ? [time] : [];
    })
    .sort((a, b) => a - b);
  const providerGeneratedAtKnown = responses.length > 0 && timestamps.length === responses.length;
  const { results, expiredCount } = projectSimSearchEntitiesForConsumption(
    responses.flatMap((page) => page.results),
    receivedAt
  );
  const warnings = Array.from(new Set(responses.flatMap((page) => page.warnings)));
  const staleResultCount = Math.max(
    results.filter((entity) => entity.stale === true).length,
    responses.reduce((sum, page) => sum + page.summary.staleResultCount, 0)
  );
  const oldest = timestamps.length > 0 ? new Date(timestamps[0]!).toISOString() : undefined;
  const newest = timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]!).toISOString() : undefined;
  const warningsKnown = responses.length > 0 && responses.every((page) => page.warningsKnown === true);
  const freshnessTimes = responses
    .flatMap((page) => (page.freshness ? [Date.parse(page.freshness.evaluatedAt)] : []))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const providerFreshnessKnown = responses.length > 0 && freshnessTimes.length === responses.length;
  const providerFreshnessTimestampState = !providerFreshnessKnown
    ? ("unknown" as const)
    : responses.some((page) => page.freshness?.feedTimestampState === "invalid")
      ? ("invalid" as const)
      : responses.some((page) => page.freshness?.feedTimestampState === "future")
        ? ("future" as const)
        : ("valid" as const);
  const consumptionExpiryKnown =
    responses.length > 0 && responses.every((page) => page.consumptionExpiry !== undefined);
  const consumptionExpiry = consumptionExpiryKnown
    ? {
        scope: "returned_entities" as const,
        derivation: "COP_DERIVED" as const,
        evaluatedAt: receivedAt.toISOString(),
        expiredCount: Math.max(
          expiredCount,
          responses.reduce((sum, page) => sum + page.consumptionExpiry!.expiredCount, 0)
        ),
        missingExpiryCount: responses.reduce((sum, page) => sum + page.consumptionExpiry!.missingExpiryCount, 0),
        invalidExpiryCount: responses.reduce((sum, page) => sum + page.consumptionExpiry!.invalidExpiryCount, 0)
      }
    : undefined;
  return {
    metadata: {
      pageCount: responses.length,
      pageStaleCount: results.filter((entity) => entity.stale === true).length,
      providerGeneratedAtKnown,
      ...(oldest ? { providerOldestGeneratedAt: oldest } : {}),
      ...(newest ? { providerNewestGeneratedAt: newest } : {}),
      receivedAt: receivedAt.toISOString(),
      responseScope: "entities-index",
      returnedCount: results.length,
      warningCount: warnings.length,
      warningsKnown,
      providerFreshnessKnown,
      providerFreshnessTimestampState,
      ...(freshnessTimes.length
        ? {
            providerFreshnessOldestEvaluatedAt: new Date(freshnessTimes[0]!).toISOString(),
            providerFreshnessNewestEvaluatedAt: new Date(freshnessTimes[freshnessTimes.length - 1]!).toISOString()
          }
        : {}),
      consumptionExpiryKnown
    },
    response: {
      contractVersion,
      ...(providerGeneratedAtKnown && oldest ? { generatedAt: oldest } : {}),
      providerId,
      query: { limit },
      results,
      summary: {
        resultCount: results.length,
        staleResultCount,
        warningCount: warnings.length
      },
      warnings,
      warningsKnown,
      ...(consumptionExpiry ? { consumptionExpiry } : {})
    }
  };
}

/** Fixed metadata whitelist for the existing structured logger, never a payload. */
export function simSearchHealthMetadata(health: SourceHealthOverride | undefined): Record<string, unknown> {
  if (!health) return { state: "unknown" };
  const result: Record<string, unknown> = { state: health.health };
  for (const key of ["generatedAt", "evaluatedAt"] as const) {
    const value = health[key];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) result[key] = new Date(value).toISOString();
  }
  const summary = health.summary ?? {};
  for (const key of [
    "resultCount",
    "staleResultCount",
    "pageCount",
    "returnedCount",
    "pageStaleCount",
    "warningCount"
  ] as const) {
    const value = summary[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) result[key] = value;
  }
  for (const key of [
    "warningsKnown",
    "providerGeneratedAtKnown",
    "providerFreshnessKnown",
    "consumptionExpiryKnown"
  ] as const) {
    if (typeof summary[key] === "boolean") result[key] = summary[key];
  }
  for (const key of [
    "receivedAt",
    "providerOldestGeneratedAt",
    "providerNewestGeneratedAt",
    "providerFreshnessOldestEvaluatedAt",
    "providerFreshnessNewestEvaluatedAt"
  ] as const) {
    const value = summary[key];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) result[key] = new Date(value).toISOString();
  }
  if (summary.responseScope === "query" || summary.responseScope === "entities-index")
    result.responseScope = summary.responseScope;
  if (
    typeof summary.providerFreshnessTimestampState === "string" &&
    ["valid", "future", "invalid", "unknown"].includes(summary.providerFreshnessTimestampState)
  )
    result.providerFreshnessTimestampState = summary.providerFreshnessTimestampState;
  const expiry = summary.consumptionExpiry;
  if (typeof expiry === "object" && expiry !== null && !Array.isArray(expiry)) {
    const value = expiry as Record<string, unknown>;
    if (
      value.derivation === "COP_DERIVED" &&
      value.scope === "returned_entities" &&
      typeof value.evaluatedAt === "string" &&
      Number.isFinite(Date.parse(value.evaluatedAt)) &&
      ["expiredCount", "missingExpiryCount", "invalidExpiryCount"].every(
        (key) => typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0
      )
    ) {
      result.consumptionExpiry = {
        derivation: "COP_DERIVED",
        scope: "returned_entities",
        evaluatedAt: new Date(value.evaluatedAt).toISOString(),
        expiredCount: value.expiredCount,
        missingExpiryCount: value.missingExpiryCount,
        invalidExpiryCount: value.invalidExpiryCount
      };
    }
  }
  return result;
}
