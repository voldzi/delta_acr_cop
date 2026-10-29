import type { LightMyRequestResponse } from "fastify";
import { AiGateway } from "@cop/ai-gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService, type AccountErasureOwnerReadiness } from "./account-erasure.js";
import { createMessagingProviderFromEnv, type MessagingProviderStatus } from "./messaging-provider.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { buildServer } from "./server.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("independent dependency health probes", () => {
  it("starts all three probes before any finishes and preserves an unavailable owner", async () => {
    vi.stubEnv("COP_HEALTH_DEPENDENCY_TIMEOUT_MS", "20000");
    vi.stubEnv("COP_AI_HEALTH_DEPENDENCY_TIMEOUT_MS", "20000");
    const service = new AccountErasureService({ store: new MemoryMobilityStore(),
      identitySecret: "synthetic-health-only-identity-secret-32-plus", issuer: "https://synthetic-health.invalid",
      requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters: [], accepted: false, allowUnboundSyntheticStore: true });
    const messaging = createMessagingProviderFromEnv({ COP_CSM_MESSAGING_ENABLED: "false" });
    const ai = AiGateway.fromEnv({ COP_AI_DEFAULT_PROVIDER: "mock" });
    const messagingStatus = await messaging.fetchStatus(new Date());
    const aiStatus = await ai.health();
    const ownerResult = deferred<AccountErasureOwnerReadiness>();
    const messagingResult = deferred<MessagingProviderStatus>();
    const aiResult = deferred<Awaited<ReturnType<AiGateway["health"]>>>();
    const ownerProbe = vi.spyOn(service, "ownerReadiness").mockReturnValue(ownerResult.promise);
    const messagingProbe = vi.spyOn(messaging, "fetchStatus").mockReturnValue(messagingResult.promise);
    const aiProbe = vi.spyOn(ai, "health").mockReturnValue(aiResult.promise);
    const app = buildServer({ accountErasure: service, messagingProvider: messaging, aiGateway: ai });
    let request: Promise<LightMyRequestResponse> | undefined;
    try {
      await app.ready();
      request = app.inject({ method: "GET", url: "/health/dependencies" });
      // This asserts causal concurrency, not a fragile wall-clock speed target.
      await vi.waitFor(() => {
        expect(ownerProbe).toHaveBeenCalledTimes(1);
        expect(messagingProbe).toHaveBeenCalledTimes(1);
        expect(aiProbe).toHaveBeenCalledTimes(1);
      }, { timeout: 1000, interval: 10 });
      ownerResult.resolve({ contractVersion: "cop-account-erasure-owner-readiness-v1", ready: false,
        checkedAt: new Date().toISOString(), unavailableReason: "adapter_unavailable" });
      messagingResult.resolve(messagingStatus); aiResult.resolve(aiStatus);
      const response = await request;
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().dependencies).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "cop-account-erasure-owners", status: "unavailable" }),
        expect.objectContaining({ name: "csm-messaging-provider", status: "disabled" }),
        expect.objectContaining({ name: "ai-gateway", status: aiStatus.status })
      ]));
    } finally {
      ownerResult.resolve({ contractVersion: "cop-account-erasure-owner-readiness-v1", ready: false,
        checkedAt: new Date().toISOString(), unavailableReason: "adapter_unavailable" });
      messagingResult.resolve(messagingStatus); aiResult.resolve(aiStatus);
      if (request) await request;
      await app.close();
    }
  });
  it("uses the longest independent probe duration instead of adding the three durations", async () => {
    vi.stubEnv("COP_HEALTH_DEPENDENCY_TIMEOUT_MS", "250");
    vi.stubEnv("COP_AI_HEALTH_DEPENDENCY_TIMEOUT_MS", "1000");
    const service = new AccountErasureService({ store: new MemoryMobilityStore(),
      identitySecret: "synthetic-timing-only-identity-secret-32-plus", issuer: "https://synthetic-timing.invalid",
      requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters: [], accepted: false, allowUnboundSyntheticStore: true });
    const messaging = createMessagingProviderFromEnv({ COP_CSM_MESSAGING_ENABLED: "false" });
    const ai = AiGateway.fromEnv({ COP_AI_DEFAULT_PROVIDER: "mock" });
    const messagingStatus = await messaging.fetchStatus(new Date()), aiStatus = await ai.health();
    const app = buildServer({ accountErasure: service, messagingProvider: messaging, aiGateway: ai });
    await app.ready();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const delay = <T>(value: () => T, milliseconds: number) => new Promise<T>(resolve => setTimeout(() => resolve(value()), milliseconds));
    vi.spyOn(service, "ownerReadiness").mockImplementation(() => delay(() => ({
      contractVersion: "cop-account-erasure-owner-readiness-v1", ready: false, checkedAt: new Date().toISOString(), unavailableReason: "adapter_unavailable"
    }), 250));
    vi.spyOn(messaging, "fetchStatus").mockImplementation(() => delay(() => messagingStatus, 250));
    vi.spyOn(ai, "health").mockImplementation(() => delay(() => aiStatus, 1000));
    const start = Date.now();
    const request = app.inject({ method: "GET", url: "/health/dependencies" });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(1000);
      const response = await request;
      expect(response.statusCode).toBe(200);
      expect(Date.now() - start).toBe(1000);
      expect(response.json().dependencies).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "cop-account-erasure-owners", status: "unavailable" }),
        expect.objectContaining({ name: "csm-messaging-provider", status: "disabled" }),
        expect.objectContaining({ name: "ai-gateway", status: aiStatus.status })
      ]));
    } finally {
      await vi.advanceTimersByTimeAsync(2000);
      await request;
      vi.useRealTimers();
      await app.close();
    }
  });

});
