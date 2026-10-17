import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { loadAccountErasureContinuity } from "./account-erasure-continuity-production.js";
import { PostgresAccountErasureContinuity } from "./account-erasure-continuity-postgres.js";
import { createMediaStorageFromEnv } from "./media-storage.js";
import { createMediaUploadSettlementFromEnv } from "./media-upload-settlement.js";
import { loadAccountErasureRuntime } from "./account-erasure-runtime.js";

vi.mock("./account-erasure-continuity-production.js", async importOriginal => ({
  ...await importOriginal<typeof import("./account-erasure-continuity-production.js")>(),
  loadAccountErasureContinuity: vi.fn()
}));
vi.mock("./media-storage.js", () => ({ createMediaStorageFromEnv: vi.fn() }));
vi.mock("./media-upload-settlement.js", () => ({ createMediaUploadSettlementFromEnv: vi.fn() }));
const issuer = "https://runtime.invalid/realms/cop", secret = "synthetic-erasure-runtime-secret-at-least32";
function fixture() {
  const guard = { end: vi.fn(async () => undefined) }, target = { end: vi.fn(async () => undefined) };
  const continuity = new PostgresAccountErasureContinuity(guard as unknown as Pool, target as unknown as Pool, {
    guardStoreId: "10000000-0000-4000-8000-000000000001", applicationStoreId: "20000000-0000-4000-8000-000000000001",
    incarnationId: "30000000-0000-4000-8000-000000000001", configurationFingerprint: "a".repeat(64)
  });
  return { continuity, guard, target };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("COP_ACCOUNT_ERASURE_ENABLED", "false");
  vi.stubEnv("COP_ACCOUNT_SAFETY_GUARD_REQUIRED", "true");
  vi.stubEnv("COP_OIDC_ISSUER", issuer);
  vi.stubEnv("COP_ACCOUNT_ERASURE_SECRET", secret);
  vi.stubEnv("COP_AI_CHAT_ROUTER_USER_ID_SECRET", "synthetic-user-runtime-secret-at-least32");
  vi.mocked(createMediaStorageFromEnv).mockReturnValue(undefined);
  vi.mocked(createMediaUploadSettlementFromEnv).mockReturnValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("production account erasure owner lifecycle", () => {
  it("does not initialize new authority while both existing production switches are off", async () => {
    vi.stubEnv("COP_ACCOUNT_SAFETY_GUARD_REQUIRED", "false");
    const runtime = await loadAccountErasureRuntime();
    expect(runtime.serverOptions).toEqual({});
    expect(loadAccountErasureContinuity).not.toHaveBeenCalled();
    expect(createMediaStorageFromEnv).not.toHaveBeenCalled();
    await runtime.close();
  });
  it("binds the actual database instance and closes all owned pools exactly once", async () => {
    const { continuity, guard, target } = fixture();
    const settlement = { close: vi.fn(async () => undefined) } as unknown as NonNullable<ReturnType<typeof createMediaUploadSettlementFromEnv>>;
    vi.mocked(loadAccountErasureContinuity).mockResolvedValue(continuity);
    vi.mocked(createMediaUploadSettlementFromEnv).mockReturnValue(settlement);
    const review = vi.spyOn(continuity, "reviewRouterIdentity").mockResolvedValue({ reviewed: false });
    const runtime = await loadAccountErasureRuntime();
    expect(runtime.serverOptions.accountErasureContinuity).toBe(continuity);
    expect(runtime.serverOptions.backupRestoreErasureAdapter?.id).toBe("backup_restore");
    expect(createMediaStorageFromEnv).toHaveBeenCalledWith(expect.any(Object), { uploadSettlement: settlement });
    // Environment changes cannot retarget an already-created identity reviewer.
    vi.stubEnv("COP_OIDC_ISSUER", "https://foreign.invalid");
    const actor = { authMode: "oidc" as const, issuer, subjectId: "synthetic-a", username: "", displayName: "" };
    const context = { routerUserId: "opaque", signal: AbortSignal.timeout(1000) };
    await runtime.serverOptions.simErasureIdentityReview!(actor, context);
    expect(review).toHaveBeenCalledWith(actor, context, { issuer, userIdSecret: "synthetic-user-runtime-secret-at-least32" });
    await runtime.close(); await runtime.close();
    expect(guard.end).toHaveBeenCalledTimes(1); expect(target.end).toHaveBeenCalledTimes(1);
    expect(settlement.close).toHaveBeenCalledTimes(1);
  });
  it("closes continuity and settlement when a configured media owner fails initialization", async () => {
    const { continuity, guard, target } = fixture();
    const settlement = { close: vi.fn(async () => undefined) } as unknown as NonNullable<ReturnType<typeof createMediaUploadSettlementFromEnv>>;
    vi.mocked(loadAccountErasureContinuity).mockResolvedValue(continuity);
    vi.mocked(createMediaUploadSettlementFromEnv).mockReturnValue(settlement);
    vi.mocked(createMediaStorageFromEnv).mockImplementationOnce(() => { throw new Error("synthetic_invalid_media"); });
    await expect(loadAccountErasureRuntime()).rejects.toThrow("synthetic_invalid_media");
    expect(guard.end).toHaveBeenCalledTimes(1); expect(target.end).toHaveBeenCalledTimes(1);
    expect(settlement.close).toHaveBeenCalledTimes(1);
  });
  it("does not promote a native authority object into the database alternative", async () => {
    const native = { snapshot: vi.fn(), assertCurrent: vi.fn(), publishFence: vi.fn(), close: vi.fn(async () => undefined) };
    vi.mocked(loadAccountErasureContinuity).mockResolvedValue(native);
    const runtime = await loadAccountErasureRuntime();
    expect(runtime.serverOptions).toEqual({ accountErasureContinuity: native });
    expect(createMediaUploadSettlementFromEnv).not.toHaveBeenCalled();
    await runtime.close(); expect(native.close).toHaveBeenCalledTimes(1);
  });
  it("refuses the native alternative for shared identity deletion before opening any owner", async () => {
    vi.stubEnv("COP_ACCOUNT_ERASURE_SCOPE", "cop_sim_shared_identity_v1");
    vi.stubEnv("COP_ACCOUNT_SAFETY_AUTHORITY_MODE", "native_v1");
    await expect(loadAccountErasureRuntime()).rejects.toThrow("independent database journal");
    expect(loadAccountErasureContinuity).not.toHaveBeenCalled();
  });
  it("binds shared deletion only to the actual PostgreSQL bridge, never an authority label", async () => {
    vi.stubEnv("COP_ACCOUNT_ERASURE_SCOPE", "cop_sim_shared_identity_v1");
    vi.stubEnv("COP_ACCOUNT_SAFETY_AUTHORITY_MODE", "database_v2");
    const native = { snapshot: vi.fn(), assertCurrent: vi.fn(), publishFence: vi.fn(), close: vi.fn(async () => undefined) };
    vi.mocked(loadAccountErasureContinuity).mockResolvedValue(native);
    await expect(loadAccountErasureRuntime()).rejects.toThrow("actual independent database journal");
    expect(native.close).toHaveBeenCalledOnce();
    const f = fixture(); vi.mocked(loadAccountErasureContinuity).mockResolvedValue(f.continuity);
    const runtime = await loadAccountErasureRuntime();
    expect(runtime.serverOptions.accountErasureContinuity).toBe(f.continuity);
    expect(runtime.serverOptions.backupRestoreErasureAdapter?.id).toBe("backup_restore");
    await runtime.close();
  });

});
