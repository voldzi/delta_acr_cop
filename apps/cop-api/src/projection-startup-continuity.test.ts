import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCopObjectFromEvent, type CanonicalEventEnvelope } from "@cop/canonical-model";
import { buildServer } from "./server.js";
import { AccountErasureService, ACCOUNT_ERASURE_ADAPTER_IDS } from "./account-erasure.js";
import type { AccountErasureContinuity } from "./account-erasure-continuity.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import type { TrackHistoryStore } from "./track-history-store.js";
import { withEventProvenance } from "./provenance.js";

const instant = Date.parse("2026-10-29T12:00:00Z");
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function fixture(failAfterSlowRead: false | "outage" | "advanced" = false) {
  for (const [key, value] of Object.entries({ NODE_ENV: "test", COP_DATABASE_URL: "", COP_AUTH_MODE: "oidc",
    COP_OIDC_ISSUER: "https://synthetic-startup.invalid/realms/cop", COP_ALLOW_LAB_TOKEN: "false", COP_WEB_BFF_SESSION_ENABLED: "false",
    COP_ACCOUNT_ERASURE_ENABLED: "false", COP_ACCOUNT_SAFETY_GUARD_REQUIRED: "false", COP_FLIGHT_DATA_ENABLED: "false",
    COP_SITUATION_DATA_ENABLED: "false", COP_SAFETY_DATA_ENABLED: "false", COP_SIM_SEARCH_DATA_ENABLED: "false", COP_TAK_GATEWAY_ENABLED: "false",
    COP_CSM_MESSAGING_ENABLED: "false", COP_AI_DEFAULT_PROVIDER: "mock", COP_AI_CONTEXT_INDEX_ENABLED: "true", COP_AI_SEMANTIC_RETRIEVAL_ENABLED: "false" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No network in synthetic cold-start test"); }));
  let clock = instant, unavailable = false, advanced = false;
  const now = () => new Date(clock), secret = "synthetic-startup-continuity-secret-more-than32", storeId = randomUUID();
  const store = new MemoryMobilityStore();
  await store.transact([], tx => tx.set("account-safety:store-identity-v1", { storeId }));
  const frontier = { sequence: 0, digest: "0".repeat(64) };
  const observations: number[] = [];
  const continuity: AccountErasureContinuity = {
    snapshot: async () => ({ contractVersion: "cop-erasure-replay-v1", applicationStoreId: storeId,
      configurationFingerprint: createHash("sha256").update("cop-account-erasure-config-v1\0").update(secret).digest("hex"), frontier, entries: [] }),
    assertCurrent: async () => {
      if (advanced) throw new Error("Synthetic advanced durable frontier");
      if (unavailable) throw new Error("Synthetic unavailable durable frontier");
      observations.push(clock); return { validUntil: new Date(clock + 5000).toISOString() };
    },
    publishFence: async () => { throw new Error("No fence writes in cold-start test"); }
  };
  const service = new AccountErasureService({ store, issuer: "https://synthetic-startup.invalid/realms/cop", identitySecret: secret,
    requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters: [], accepted: false, expectedGuardStoreId: storeId,
    continuityRequired: true, continuity, now });
  const event: CanonicalEventEnvelope = { eventId: randomUUID(), correlationId: randomUUID(), contractVersion: "cop-ingest-v1", eventType: "track.updated",
    source: { sourceSystemId: "synthetic-public-source", adapterId: "synthetic", adapterVersion: "1" }, producerTimestamp: now().toISOString(), ingestTimestamp: now().toISOString(),
    classification: { level: "UNCLASSIFIED", releasability: ["CZ"], handlingCaveats: [] }, quality: { confidence: 1, sourceReliability: "UNKNOWN", informationCredibility: "UNKNOWN" },
    geo: { lat: 50, lon: 14 }, simulation: { synthetic: true }, payload: { objectId: randomUUID(), objectType: "AIRCRAFT", affiliation: "FRIEND", domain: "AIR", status: "ACTIVE" } };
  const object = withEventProvenance(createCopObjectFromEvent(event), event);
  const history: TrackHistoryStore = { name: "synthetic-persistent-port", init: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
    loadCurrent: vi.fn(async () => [object]), countCurrent: async () => 1, count: async () => 0,
    query: vi.fn(async () => { clock += 6000; unavailable = failAfterSlowRead === "outage"; advanced = failAfterSlowRead === "advanced"; return []; }),
    append: vi.fn(async () => { throw new Error("Unexpected DB write in hydration test"); }),
    upsertCurrent: vi.fn(async () => { throw new Error("Unexpected DB write in hydration test"); }),
    loadProjectionFences: async () => ({ resources: [], ownerHashes: [], subjectHashes: [], version: "synthetic-empty-frontier" }), projectionErasureReady: async () => true };
  const app = buildServer({ accountErasure: service, trackHistoryStore: history, now });
  return { app, service, history, observations, advance: () => { clock += 5001; } };
}

describe("cold startup with durable erasure observation and slow track hydration", () => {
  it("renews the actual five-second observation after a slow persisted-history read", async () => {
    const f = await fixture();
    try {
      await f.app.ready();
      expect(f.history.query).toHaveBeenCalled();
      expect(f.observations.some(value => value >= instant + 6000)).toBe(true);
      expect(f.history.upsertCurrent).not.toHaveBeenCalled(); expect(f.history.append).not.toHaveBeenCalled();
      const response = await f.app.inject({ method: "GET", url: "/health/live" }); expect(response.statusCode).toBe(200);
      f.advance(); expect(f.service.cachedGuardReady()).toBe(false);
    } finally { await f.app.close(); }
  });
  it("does not adopt an advanced durable frontier after the slow read", async () => {
    const f = await fixture("advanced");
    try {
      await expect(f.app.ready()).rejects.toMatchObject({ status: 503 });
      expect(f.service.cachedGuardReady()).toBe(false);
      expect(f.history.upsertCurrent).not.toHaveBeenCalled(); expect(f.history.append).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });
  it("keeps startup closed if durable admission is unavailable after the slow read", async () => {
    const f = await fixture("outage");
    try {
      await expect(f.app.ready()).rejects.toMatchObject({ status: 503 });
      expect(f.history.upsertCurrent).not.toHaveBeenCalled(); expect(f.history.append).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });
});
