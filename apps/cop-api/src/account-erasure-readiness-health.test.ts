import { describe, expect, it, vi } from "vitest";
import { createAccountErasureReadinessHealth } from "./account-erasure-readiness-health.js";
import type { AccountErasureOwnerReadiness } from "./account-erasure.js";
const at = Date.parse("2026-10-16T12:00:00Z");
const proof = (ready = true): AccountErasureOwnerReadiness => ({ contractVersion: "cop-account-erasure-owner-readiness-v1", ready, checkedAt: new Date(at).toISOString(), ...(!ready ? { unavailableReason: "adapter_unavailable" as const } : {}) });
describe("bounded aggregate owner health", () => {
  it("shares concurrent probes and keeps the public result free of owner data", async () => {
    let release!: (value: AccountErasureOwnerReadiness) => void;
    const ownerReadiness = vi.fn(() => new Promise<AccountErasureOwnerReadiness>(resolve => { release = resolve; }));
    const owner = { ownerReadiness }, shared = createAccountErasureReadinessHealth(() => owner, () => at);
    const a = shared(), b = shared(); expect(ownerReadiness).toHaveBeenCalledTimes(1); release(proof());
    expect(await a).toEqual(await b); expect(await shared()).toEqual({ name: "cop-account-erasure-owners", status: "ok", checkedAt: proof().checkedAt, detail: "Read-only owner checks; deletion intake is controlled separately." });
    expect(ownerReadiness).toHaveBeenCalledTimes(1);
  });
  it("refreshes after the cache expires and does not keep stale success on failure", async () => {
    let now = at;
    const owner = { ownerReadiness: vi.fn().mockResolvedValueOnce(proof()).mockRejectedValueOnce(Error("PRIVATE_PROVIDER_DETAIL")) };
    const health = createAccountErasureReadinessHealth(() => owner, () => now);
    expect((await health()).status).toBe("ok"); now += 30_001;
    const actual = await health(); expect(actual.status).toBe("unavailable"); expect(JSON.stringify(actual)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  });
  it("rejects stale, future or extended payloads and a removed controller", async () => {
    for (const bad of [{ ...proof(), checkedAt: new Date(at - 30_001).toISOString() }, { ...proof(), checkedAt: new Date(at + 1).toISOString() }, { ...proof(), secret: "not-public" }, { ...proof(), unavailableReason: "adapter_unavailable" as const }]) {
      expect((await createAccountErasureReadinessHealth(() => ({ ownerReadiness: async () => bad }), () => at)()).status).toBe("unavailable");
    }
    expect((await createAccountErasureReadinessHealth(() => undefined)()).status).toBe("disabled");
  });
  it("never converts an actual unavailable result into ready", async () => {
    expect((await createAccountErasureReadinessHealth(() => ({ ownerReadiness: async () => proof(false) }), () => at)()).status).toBe("unavailable");
  });
});
